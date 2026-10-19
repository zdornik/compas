// Run only as a CLI, against public reference reads. Never loaded by the server.
import pg from 'pg';
import {readFile,writeFile} from 'node:fs/promises';
import {createKnowledgeApi} from './knowledge.mjs';
const fixture=JSON.parse(await readFile('qa/reference-benchmark-before.json'));
const pool=new pg.Pool({host:'db',database:'compass',user:'compass_admin',password:(await readFile(process.env.DB_PASSWORD_FILE,'utf8')).trim(),max:2});
const output=[];
try{
 for(const sample of fixture.results){
  const calls=[],db={query:async(sql,params)=>{calls.push({sql,params});return pool.query(sql,params);}},res={writeHead(){},end(){}};
  await createKnowledgeApi(db)({method:'GET',url:sample.path},res,sample.path.split('?')[0]);
  for(const {sql,params} of calls){
   if(!/^SELECT|^WITH/.test(sql.trim())||!sql.includes('knowledge.')||/patient_entries|care_|app_sessions|local_patients/.test(sql))throw new Error('Public SELECT profiling only');
   const result=(await pool.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+sql,params)).rows[0]['QUERY PLAN'][0],scans=[];
   const walk=node=>{if(node['Relation Name']||node['Index Name'])scans.push({type:node['Node Type'],relation:node['Relation Name'],index:node['Index Name'],rows:node['Actual Rows'],loops:node['Actual Loops'],removed:node['Rows Removed by Filter']});for(const plan of node.Plans||[])walk(plan);};walk(result.Plan);
   output.push({name:sample.name,executionMs:result['Execution Time'],planningMs:result['Planning Time'],scans});
  }
  console.log(JSON.stringify({name:sample.name,queries:calls.length,executionMs:Math.round(output.filter(row=>row.name===sample.name).reduce((n,row)=>n+row.executionMs,0)*10)/10}));
 }
 await writeFile('qa/reference-plans-'+(process.argv.includes('--after')?'after':'before')+'.json',JSON.stringify(output,null,2)+'\n');
}finally{await pool.end();}
