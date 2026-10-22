import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {seal,unseal} from '../server/crypto.mjs';
import {stubJournalAnalysis,validateJournalAnalysis,analysisContext} from '../server/journal-policy.mjs';

export async function processJournalJob(pool,key,{analyze=stubJournalAnalysis}={}){
 const token=randomUUID(),job=(await pool.query('SELECT * FROM public.journal_claim($1)',[token])).rows[0];if(!job)return false;
 try{
  const source=(await pool.query('SELECT * FROM public.journal_load($1,$2)',[job.id,token])).rows[0];if(!source)return true;
  const note=unseal(source.payload,key,source.cipher_context),result=validateJournalAnalysis(await analyze({title:note.title,body:note.body}),note);
  await pool.query('SELECT public.journal_complete($1,$2,$3,$4)',[job.id,token,seal(result,key,analysisContext(job.id)),result.signalLevel]);
 }catch(error){await pool.query('SELECT public.journal_fail($1,$2,$3)',[job.id,token,error.message==='INVALID_ANALYSIS'?'INVALID_ANALYSIS':'STUB_ERROR']);}
 return true;
}
export async function runJournalWorker(){
 if(process.env.JOURNAL_ANALYSIS_ENABLED!=='1')return console.log('Journal worker disabled.');
 if((process.env.JOURNAL_PROVIDER||'stub')!=='stub')throw Error('Only the explicit local stub is implemented; no external calls are permitted.');
 const password=(await readFile(process.env.JOURNAL_DB_PASSWORD_FILE,'utf8')).trim(),key=Buffer.from((await readFile(process.env.DATA_KEY_FILE,'utf8')).trim(),'base64');if(key.length!==32)throw Error('Invalid data key');
 const pool=new pg.Pool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||5432),database:process.env.DB_NAME||'compass',user:'compass_journal_worker',password,max:2,connectionTimeoutMillis:5000});
 let stopped=false;const stop=()=>{stopped=true;};process.on('SIGINT',stop);process.on('SIGTERM',stop);
 console.log('Journal worker: local test stub, no neural network or external requests.');
 try{while(!stopped){try{if(await processJournalJob(pool,key))continue;}catch{console.error('Journal worker database unavailable');}await new Promise(resolve=>setTimeout(resolve,1000));}}finally{await pool.end();}
}
if(process.argv[1]&&import.meta.url===new URL(process.argv[1],'file:').href)await runJournalWorker();
