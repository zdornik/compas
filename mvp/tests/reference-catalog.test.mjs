import test from 'node:test';
import assert from 'node:assert/strict';
import {searchCatalogProducts,catalogSuggestions} from '../server/reference-catalog.mjs';
import {parseKnowledgeQuery,createKnowledgeApi} from '../server/knowledge.mjs';
test('catalog escapes literal searches and keeps count and page in one snapshot',async()=>{
 const calls=[],q="%_';DROP TABLE x;--",db={async query(sql,values){calls.push({sql,values});return {rows:[{items:[],total:0}]};}};
 assert.deepEqual(await searchCatalogProducts(db,parseKnowledgeQuery('?q='+encodeURIComponent(q))),{items:[],total:0,limit:20,offset:0});
 assert.equal(calls.length,1);assert.ok(!calls[0].sql.includes(q));assert.equal(calls[0].values[1],"%\\%\\_';DROP TABLE x;--%");
 assert.match(calls[0].sql,/matched AS MATERIALIZED/);
});
test('missing publication returns unavailable rather than an empty successful catalog',async()=>{
 await assert.rejects(()=>searchCatalogProducts({query:async()=>({rows:[{items:[],total:null}]})},parseKnowledgeQuery('')),/not published/);
 const res={writeHead(status){this.status=status;},end(body){this.body=JSON.parse(body);}};
 await createKnowledgeApi({query:async()=>({rows:[]})})({method:'GET',url:'/api/knowledge/status'},res,'/api/knowledge/status');assert.equal(res.status,503);
});
test('short autocomplete does not occupy the database pool',async()=>{
 assert.deepEqual(await catalogSuggestions({query(){throw new Error('Unexpected query');}},'a'),{substances:[],products:[]});
});
