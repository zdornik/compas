import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assessInteractionCoverage, parseKnowledgeQuery, createKnowledgeApi } from '../server/knowledge.mjs';
const response=()=>({headers:{},writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body;}});

test('reference search constrains pagination and document kinds without accepting query code',()=>{
 const p=parseKnowledgeQuery('?q=%20Сертралин%20%20&limit=999&offset=40&page=0');
 assert.equal(p.q,'Сертралин');assert.equal(p.limit,100);assert.equal(p.offset,40);assert.equal(p.page,1);
 assert.equal(parseKnowledgeQuery('?q='+encodeURIComponent('а'.repeat(500))).q.length,160);
 assert.throws(()=>parseKnowledgeQuery('?offset=-1'),error=>error.status===400);
 assert.throws(()=>parseKnowledgeQuery('?kind=patient_entries'),error=>error.status===400);
});
test('an absent pair, incomplete mapping or empty source never asserts medication safety',()=>{
 for(const input of [{loaded:0,selected:2},{loaded:100,mapped:1,selected:2},{loaded:100,mapped:2,selected:2,found:0},{loaded:100,mapped:2,selected:2,found:1}])assert.equal(assessInteractionCoverage(input).safeToCombine,null);
 assert.equal(assessInteractionCoverage({loaded:0,selected:2}).status,'not_checked');
 assert.equal(assessInteractionCoverage({loaded:100,mapped:1,selected:2}).status,'unmapped');
});
test('the reference API exposes no web writes and does not query any patient table',async()=>{
 let queried=false;const api=createKnowledgeApi({query(){queried=true;throw new Error('Must not query');}});const res=response();
 await api({method:'POST',url:'/api/knowledge/documents'},res,'/api/knowledge/documents');
 assert.equal(res.status,405);assert.equal(queried,false);
 const source=await readFile('server/knowledge.mjs','utf8');assert.doesNotMatch(source,/patient_entries|app_sessions|patient_doses|local_patients/);
});
test('reference text search is parameterized and LIKE metacharacters are escaped',async()=>{
 const calls=[];const api=createKnowledgeApi({async query(sql,params){calls.push({sql,params});return {rows:sql.includes('count(*)::int n')?[{n:0}]:[]};}});const res=response();const text="%_';DROP TABLE x;--";
 await api({method:'GET',url:'/api/knowledge/documents?q='+encodeURIComponent(text)},res,'/api/knowledge/documents');
 assert.equal(res.status,200);assert.equal(calls.length,2);
 for(const call of calls){assert.ok(!call.sql.includes(text));assert.equal(call.params[1],text);assert.ok(call.params[2].startsWith('%\\%\\_'));}
});
test('DDI lookup treats registry INNs as unreviewed rather than automatic source mappings',async()=>{
 const ids=['grls:'+'a'.repeat(64),'grls:'+'b'.repeat(64)];
 const api=createKnowledgeApi({async query(sql){
  if(sql.includes('FROM knowledge.products WHERE id=ANY'))return {rows:ids.map((id,index)=>({id,name:'Пример',inn:'МНН',substanceId:'inn:'+index}))};
  if(sql.includes('count(*) n FROM knowledge.interactions'))return {rows:[{n:'100'}]};
  if(sql.includes('reviewed_ddinter_mapping'))return {rows:[{n:0}]};
  return {rows:[]};
 }});const res=response();await api({method:'GET',url:'/api/knowledge/interactions?'+ids.map(id=>'id='+id).join('&')},res,'/api/knowledge/interactions');
 const data=JSON.parse(res.body);assert.equal(data.status,'unmapped');assert.equal(data.safeToCombine,null);assert.equal(data.clinicalUseApproved,false);
});
test('knowledge schema grants the runtime read access without reference-data writes',async()=>{
 const sql=await readFile('docker/migrations/002-knowledge.sql','utf8');
 assert.match(sql,/GRANT SELECT ON ALL TABLES IN SCHEMA knowledge TO compass_app/);
 assert.doesNotMatch(sql,/GRANT (?:ALL|INSERT|UPDATE|DELETE)[^;]+compass_app/);
 assert.match(sql,/FOREIGN KEY\(document_id,page\) REFERENCES knowledge.pages/);
 assert.match(sql,/clinical_use_approved boolean NOT NULL DEFAULT false/);
});

test('colloquial condition search expands explicit synonyms without assigning a diagnosis',async()=>{
 const {conditionSearchIntent,searchConditions}=await import('../server/condition-search.mjs');
 assert.equal(conditionSearchIntent('гипертония').term,'гипертенз');assert.equal(conditionSearchIntent('гипертония').preferred[0],'I10');
 assert.equal(conditionSearchIntent('БАР').preferred[0],'F31');assert.equal(conditionSearchIntent('ОКР').preferred[0],'F42');assert.equal(conditionSearchIntent('боль в голове').preferred.length,0);
 assert.equal(conditionSearchIntent('гипертензия новорожденного').specificAge,true);assert.equal(conditionSearchIntent('гипертензия').specificAge,false);
 const calls=[];const result=await searchConditions({query:async(sql,values)=>{calls.push({sql,values});return{rows:[{code:'I10',name:'Эссенциальная [первичная] гипертензия'}]};}},'гипертония');
 assert.equal(result.items[0].code,'I10');assert.equal(result.matchedAlias,'гипертония');assert.equal(calls[0].values[1],'%гипертенз%');assert.equal(calls[0].sql.includes('гипертония'),false);
});
