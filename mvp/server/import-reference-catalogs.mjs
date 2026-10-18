// Offline public-reference importer. No patient data, no network, no runtime writes.
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const read=async path=>JSON.parse(await readFile('knowledge/'+path,'utf8'));
const hash=value=>createHash('sha256').update(value).digest('hex');
const manifest=await read('openmrs-manifest.json'),raw=await readFile('knowledge/raw/openmrs/kb.json');
if(hash(raw)!==manifest.sha256)throw new Error('OpenMRS checksum mismatch');
const kb=JSON.parse(raw),drugs=new Map(kb.drugs.map(row=>[row.id,row])),source='openmrs-ddinter';
if(drugs.size!==2283||kb.interactions.length!==295184||kb.disease_interactions.length!==8346)throw new Error('Unexpected source counts');
const sourceUrl=manifest.repository+'/blob/'+manifest.commit+'/kb.json';
const quarantined=kb.interactions.filter(([a,b])=>a===b);
const interactions=kb.interactions.filter(([a,b])=>a!==b).map(([a,b,severity,mechanismId])=>{
 if(!drugs.has(a)||!drugs.has(b)||!Object.hasOwn(kb.mechanisms,mechanismId)||!['Major','Moderate','Minor','Unknown'].includes(severity))throw new Error('Invalid interaction');
 [a,b]=[a,b].sort();return {id:source+':'+a+':'+b,source_id:source,source_drug_a_id:a,source_drug_b_id:b,drug_a_name:drugs.get(a).name,drug_b_name:drugs.get(b).name,source_severity:severity,mechanism:kb.mechanisms[mechanismId].text,source_url:sourceUrl,source_sha256:manifest.sha256,metadata:{mechanismId,commit:manifest.commit,categories:kb.mechanisms[mechanismId].categories}};
});
if(new Set(interactions.map(row=>row.id)).size!==interactions.length)throw new Error('Duplicate source pairs');
const diseaseRows=[...new Map(kb.disease_interactions.map(row=>[JSON.stringify(row),row])).values()];
const diseases=diseaseRows.map(([drug,condition,severity,noteId])=>{
 const note=kb.disease_notes[noteId];if(!drugs.has(drug)||!note)throw new Error('Broken disease reference');
 return {id:source+':disease:'+hash(JSON.stringify([drug,condition,severity,noteId])),source_id:source,drug_id:drug,condition_name:condition,severity,note:note.text,references_json:note.references||[],source_url:sourceUrl,source_sha256:manifest.sha256,metadata:{noteId,commit:manifest.commit}};
});
const conditions=await read('processed/conditions.json'),icd=await read('icd10-manifest.json');
if(hash(await readFile('knowledge/raw/icd10/ru.csv'))!==icd.sha256||conditions.length!==icd.records)throw new Error('ICD checksum mismatch');
const links=await read('ingredient-source-links.json');
const pool=new pg.Pool({host:process.env.DB_HOST||'db',database:'compass',user:'compass_admin',password:(await readFile(process.env.DB_PASSWORD_FILE,'utf8')).trim(),max:1});
const db=await pool.connect();
async function bulk(table,rows,types,conflict){
 const names=Object.keys(types),columns=names.join(','),defs=names.map(name=>name+' '+types[name]).join(',');
 for(let i=0;i<rows.length;i+=4000)await db.query(`INSERT INTO knowledge.${table}(${columns}) SELECT ${columns} FROM jsonb_to_recordset($1::jsonb) AS x(${defs}) ON CONFLICT ${conflict}`,[JSON.stringify(rows.slice(i,i+4000))]);
}
try{
 await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(2026101807)');
 for(const item of [{id:source,name:'OpenMRS DDI knowledge base · DDInter 2.0',url:manifest.repository,license:manifest.license,coverage:'Прямые пары и исходные сведения о заболеваниях. Производный уровень не импортирован.',metadata:{...manifest,importedPairs:interactions.length,importedDiseaseRecords:diseases.length,quarantinedSelfPairs:quarantined,deduplicatedDiseaseRecords:kb.disease_interactions.length-diseases.length}},{id:'icd10-ru-nsi',name:'МКБ-10 · НСИ, версия 2.27 (зеркало)',url:icd.sourceUrl,license:'Классификатор НСИ; зеркало ak4nv/mkb10. Условия исходного классификатора сохраняются.',coverage:'Коды диагнозов, включая острые и хронические; актуальность последней версии не подтверждена.',metadata:icd}])await db.query(`INSERT INTO knowledge.sources(id,name,url,license,coverage,metadata,retrieved_at) VALUES($1,$2,$3,$4,$5,$6,now()) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,license=EXCLUDED.license,coverage=EXCLUDED.coverage,metadata=EXCLUDED.metadata,retrieved_at=now()`,[item.id,item.name,item.url,item.license,item.coverage,JSON.stringify(item.metadata)]);
 await bulk('source_drugs',kb.drugs.map(row=>({source_id:source,id:row.id,name:row.name,rxcui:row.rxcui,atc:row.atc||[],metadata:row})),{source_id:'text',id:'text',name:'text',rxcui:'text',atc:'text[]',metadata:'jsonb'},'(source_id,id) DO UPDATE SET metadata=EXCLUDED.metadata');
 await bulk('interactions',interactions,{id:'text',source_id:'text',source_drug_a_id:'text',source_drug_b_id:'text',drug_a_name:'text',drug_b_name:'text',source_severity:'text',mechanism:'text',source_url:'text',source_sha256:'text',metadata:'jsonb'},'(id) DO UPDATE SET mechanism=EXCLUDED.mechanism,source_severity=EXCLUDED.source_severity,source_sha256=EXCLUDED.source_sha256,metadata=EXCLUDED.metadata');
 await bulk('disease_interactions',diseases,{id:'text',source_id:'text',drug_id:'text',condition_name:'text',severity:'text',note:'text',references_json:'jsonb',source_url:'text',source_sha256:'text',metadata:'jsonb'},'(id) DO UPDATE SET note=EXCLUDED.note,source_sha256=EXCLUDED.source_sha256');
 await bulk('conditions',conditions,{code:'text',name_ru:'text',name_en:'text',parent_code:'text',source_id:'text',source_version:'text',source_url:'text',source_sha256:'text'},'(code) DO UPDATE SET name_ru=EXCLUDED.name_ru,name_en=EXCLUDED.name_en');
 // Only exact, normalized English labels join. A Russian free-text diagnosis is never guessed.
 await db.query(`INSERT INTO knowledge.condition_mappings(code,source_id,condition_name,relation,review_status,evidence) SELECT DISTINCT c.code,d.source_id,d.condition_name,'exact','source_verified',jsonb_build_array(jsonb_build_object('method','exact_WHO_2019_English_label','code',c.code,'name',c.name_en,'englishSource',$1::text)) FROM knowledge.conditions c JOIN knowledge.disease_interactions d ON lower(c.name_en)=lower(d.condition_name) ON CONFLICT DO NOTHING`,[icd.englishSource]);
 for(const row of await read('condition-source-links.json')){
  const condition=conditions.find(item=>item.code===row.code);if(condition?.name_en!==row.englishLabel||!diseases.some(item=>item.condition_name===row.sourceCondition))throw new Error('Condition crosswalk evidence mismatch');
  await db.query("INSERT INTO knowledge.condition_mappings(code,source_id,condition_name,relation,review_status,evidence) VALUES($1,$2,$3,$4,'source_verified',$5) ON CONFLICT DO NOTHING",[row.code,source,row.sourceCondition,row.relation,JSON.stringify([{...row,englishSource:icd.englishSource,sourceSha256:manifest.sha256,clinicalUseApproved:false}])]);
 }
 for(const link of links){
  const drug=drugs.get(link.providerId);if(!drug||drug.name.toLowerCase()!==link.nameEn||!drug.atc.includes(link.atc)||!link.evidence.every(row=>row.sha256||row.commit))throw new Error('Unverified ingredient identity');
  const who=await readFile('knowledge/raw/atc/'+link.atc+'.html'),whoEvidence=link.evidence.find(row=>row.kind==='who_atc_identity');
  if(hash(who)!==whoEvidence?.sha256||!who.toString('latin1').includes('>'+link.nameEn+'</a>'))throw new Error('WHO identity evidence mismatch');
  const matches=(await db.query('SELECT id FROM knowledge.substances WHERE lower(name_ru)=lower($1)',[link.nameRu])).rows;if(matches.length!==1)continue;
  const id='inn:'+link.nameEn,evidence=JSON.stringify(link.evidence),substance=matches[0].id;
  const official=(await db.query('SELECT sha256 FROM knowledge.documents WHERE id=$1',[link.evidence[0].documentId])).rows[0];if(official?.sha256!==link.evidence[0].sha256)throw new Error('GRLS evidence hash mismatch');
  await db.query("INSERT INTO knowledge.ingredient_entities(id,name_ru,name_en,chemical_form,review_status,evidence) VALUES($1,$2,$3,'active_moiety','reviewed',$4) ON CONFLICT(id) DO UPDATE SET evidence=EXCLUDED.evidence",[id,link.nameRu,link.nameEn,evidence]);
  await db.query("INSERT INTO knowledge.registry_compositions(substance_id,expected_components,review_status,evidence) VALUES($1,1,'reviewed',$2) ON CONFLICT(substance_id) DO UPDATE SET evidence=EXCLUDED.evidence",[substance,evidence]);
  await db.query("INSERT INTO knowledge.registry_components(substance_id,ingredient_id,chemical_form,relation,review_status,evidence) VALUES($1,$2,'active_moiety','reviewed_active_moiety','reviewed',$3) ON CONFLICT(substance_id,ingredient_id) DO UPDATE SET evidence=EXCLUDED.evidence",[substance,id,evidence]);
  await db.query("INSERT INTO knowledge.provider_ingredients(ingredient_id,provider,external_id,external_name,review_status,evidence) VALUES($1,'ddinter',$2,$3,'reviewed',$4) ON CONFLICT DO NOTHING",[id,link.providerId,drug.name,evidence]);
  await db.query("UPDATE knowledge.substances SET name_en=$2,mapping_status='source_verified' WHERE id=$1",[substance,link.nameEn]);
 }
 await db.query('COMMIT');console.log(JSON.stringify({interactions:interactions.length,diseaseInteractions:diseases.length,conditions:conditions.length,quarantinedSelfPairs:quarantined.length,deduplicatedDiseaseRecords:kb.disease_interactions.length-diseases.length,derivedImported:0,ingredientSourceLinks:links.length,clinicalUseApproved:false}));
}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();await pool.end();}
