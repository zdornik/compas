import pg from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dayKey } from '../src/domain.js';
import { seal, unseal, tokenHash } from './crypto.mjs';
import { validateEntry } from './validation.mjs';
import { createKnowledgeApi } from './knowledge.mjs';
import {canonicalMedicalInput,canonicalMedicationInput} from './medical-reference.mjs';
import { createCareStore } from './care-store.mjs';
import {createAuthStore,readPatientConsent} from './auth-store.mjs';
import {createCareChatStore} from './chat-store.mjs';
import {createJournalStore,syncJournalAccess} from './journal-store.mjs';
import {createAppointmentStore} from './appointment-store.mjs';

export async function createStore() {
  const password = (await readFile(process.env.DB_PASSWORD_FILE, 'utf8')).trim();
  const key = Buffer.from((await readFile(process.env.DATA_KEY_FILE, 'utf8')).trim(), 'base64');
  if (key.length !== 32) throw new Error('A 256-bit data key is required');
  const pool = new pg.Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT||5432), database: process.env.DB_NAME||'compass', user: 'compass_app', password, max: 8, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 });
  pool.on('error', () => console.error('Database connection unavailable'));
  const transaction = async (patientId, callback) => {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      if (patientId) await db.query("SELECT set_config('app.patient_id', $1, true)", [patientId]);
      const result = await callback(db);
      await db.query('COMMIT'); return result;
    } catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
  };
  const decode = (row, patientId) => unseal(row.payload, key, `${patientId}:${row.id}`);
  const journal=createJournalStore({transaction,key});
  return {
    close:()=>pool.end(),
    journal,
    appointments:createAppointmentStore({transaction,key}),
    care: createCareStore({ transaction, key, decode }),
    auth:createAuthStore({transaction,key}),
    chat:createCareChatStore({transaction,key}),
    reference: createKnowledgeApi(pool),
    async health() { await pool.query('SELECT 1'); },
    async session(token) {
      if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
      const result = await pool.query('SELECT patient_id, csrf_token, token_hash, doctor_enabled, account_id FROM app_sessions WHERE token_hash = $1 AND expires_at > now()', [tokenHash(token)]);
      const current=result.rows[0];if(!current)return null;
      if(current.account_id){
        const account=await transaction(current.patient_id,async db=>(await db.query('SELECT role FROM auth_accounts WHERE id=$1 AND principal_id=$2',[current.account_id,current.patient_id])).rows[0]);
        if(!account)return null;current.account_role=account.role;current.doctor_enabled=account.role==='doctor';
      }
      return current;
    },
    async createSession() {
      const token = randomBytes(32).toString('hex'), csrfToken = randomBytes(32).toString('hex'), patientId = randomUUID();
      await transaction(patientId, async db => {
        await db.query('INSERT INTO local_patients (id) VALUES ($1)', [patientId]);
        await db.query("INSERT INTO app_sessions (token_hash, patient_id, csrf_token, expires_at) VALUES ($1,$2,$3,now() + interval '30 days')", [tokenHash(token), patientId, csrfToken]);

      });
      return { token, csrfToken };
    },
    async state(patientId) {
      return transaction(patientId, async db => {
        const entries = await db.query('SELECT e.id,e.payload,n.current_revision FROM patient_entries e LEFT JOIN journal_notes n ON n.patient_id=e.patient_id AND n.entry_id=e.id ORDER BY e.saved_at DESC, e.id');
        const doses = await db.query('SELECT dose_id,status FROM patient_doses WHERE observation_day = $1', [dayKey()]);
        return { entries: entries.rows.map(row => ({...decode(row, patientId),...(row.current_revision?{revision:row.current_revision}:{})})), doses: ['one', 'two'].map((id, index) => ({ id, name: `Препарат ${index + 1}`, status: doses.rows.find(row => row.dose_id === id)?.status || 'planned' })) };
      });
    },
    async saveEntry(patientId, id, input) {
      return transaction(patientId, async db => {
        // Serialise writes for a patient, including retries of a new record.
        await db.query('SELECT id FROM local_patients WHERE id = $1 FOR UPDATE', [patientId]);
        if((await readPatientConsent(db,patientId,key)).healthData!==true)throw Object.assign(new Error('Согласие на обработку данных отозвано'),{status:403});
        const old = await db.query('SELECT id,payload FROM patient_entries WHERE id = $1', [id]);
        if(input.type==='medical-profile')input=await canonicalMedicalInput(db,input);
        if(input.type==='medication-plan')input=await canonicalMedicationInput(db,input);
        let plan = null;
        if (input.type === 'medication-dose' && typeof input.planId === 'string') {
          const found = await db.query("SELECT id,payload FROM patient_entries WHERE id = $1 AND type = 'medication-plan'", [input.planId]);
          if (found.rows[0]) plan = decode(found.rows[0], patientId);
        }
        if(input.type==='journal'){
          await syncJournalAccess(db,patientId,await readPatientConsent(db,patientId,key));
          return journal.save(db,patientId,id,input,old.rows[0]?decode(old.rows[0],patientId):null);
        }
        const record = validateEntry(input, id, old.rows[0] ? decode(old.rows[0], patientId) : null, new Date(), { plan });
        await db.query('INSERT INTO patient_entries (patient_id,id,type,observation_day,payload) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (patient_id,id) DO UPDATE SET observation_day = EXCLUDED.observation_day,payload = EXCLUDED.payload,saved_at = now()', [patientId, id, record.type, record.day, seal(record, key, `${patientId}:${id}`)]);
        return record;
      });
    },
    async dose(patientId, id, status) {
      if (!['one', 'two'].includes(id) || !['taken', 'skipped', 'planned'].includes(status)) throw new Error('Некорректная отметка приёма');
      await transaction(patientId, db => db.query('INSERT INTO patient_doses (patient_id,observation_day,dose_id,status) VALUES ($1,$2,$3,$4) ON CONFLICT (patient_id,observation_day,dose_id) DO UPDATE SET status = EXCLUDED.status', [patientId, dayKey(), id, status]));
      return { id, status };
    },
  };
}
