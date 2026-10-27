// Upgrade an isolated synthetic database from the historical 016 schema.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {databaseConfig,createIsolatedDatabase,migrateIsolatedDatabase,applyRepositoryMigrations,adminClient,dropIsolatedDatabase} from './database-tools.mjs';
import {seal,unseal} from '../server/crypto.mjs';

const config=await databaseConfig(),database='compass_journal_qa_'+randomBytes(6).toString('hex');
const key=randomBytes(32),patient=randomUUID(),fixtures=[];
let created=false;
try{
  await createIsolatedDatabase(config,database);created=true;
  await migrateIsolatedDatabase(config,database,{through:16});
  const client=await adminClient(config,database);
  try{
    await client.query('INSERT INTO local_patients(id) VALUES($1)',[patient]);
    for(let index=0;index<3;index++){
      const entry={id:randomUUID(),type:'journal',title:'Историческая тестовая запись '+index,body:'Вымышленный текст до миграции. '+index,day:'2026-10-17',at:'2026-10-17T09:00:00.000Z'};
      const payload=seal(entry,key,patient+':'+entry.id);fixtures.push({entry,payload});
      await client.query('INSERT INTO patient_entries(patient_id,id,type,observation_day,payload,saved_at) VALUES($1,$2,$3,$4,$5,$6)',[patient,entry.id,entry.type,entry.day,payload,entry.at]);
    }
  }finally{await client.end();}
  await applyRepositoryMigrations(config,database);
  await applyRepositoryMigrations(config,database);
  const verify=await adminClient(config,database);
  try{
    const rows=(await verify.query('SELECT e.id,e.payload AS original,n.current_revision,r.payload,r.cipher_context FROM patient_entries e JOIN journal_notes n ON (n.patient_id,n.entry_id)=(e.patient_id,e.id) JOIN journal_note_revisions r ON (r.patient_id,r.entry_id,r.revision)=(n.patient_id,n.entry_id,n.current_revision) ORDER BY e.id')).rows;
    assert.equal(rows.length,fixtures.length);
    for(const {entry,payload} of fixtures){
      const row=rows.find(value=>value.id===entry.id);assert.equal(row.current_revision,1);
      assert.deepEqual(row.original,payload);assert.deepEqual(row.payload,payload);
      assert.deepEqual(unseal(row.payload,key,row.cipher_context),entry);
    }
    assert.equal(Number((await verify.query('SELECT count(*) FROM journal_analysis_jobs')).rows[0].count),0);
    assert.equal(Number((await verify.query("SELECT count(*) FROM schema_migrations WHERE id='021-care-tracking'")).rows[0].count),1);
    console.log('Legacy 016 to latest migration passed: originals preserved, journal versions readable, repeated migration safe, no historical analysis scheduled.');
  }finally{await verify.end();}
}finally{if(created)await dropIsolatedDatabase(config,database);}
