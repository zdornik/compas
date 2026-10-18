\set app_password `cat /run/secrets/app_db_password`
CREATE ROLE compass_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO compass_app;
CREATE TABLE local_patients (id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE app_sessions (
  token_hash text PRIMARY KEY, patient_id uuid NOT NULL REFERENCES local_patients(id),
  csrf_token text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expiry_idx ON app_sessions(expires_at);
CREATE TABLE patient_entries (
  patient_id uuid NOT NULL REFERENCES local_patients(id), id text NOT NULL,
  type text NOT NULL CHECK (type IN ('journal','mood','sleep','assessment','medication-plan','medication-dose','medical-profile')),
  observation_day date NOT NULL, payload bytea NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (patient_id,id)
);
CREATE INDEX entries_day_idx ON patient_entries(patient_id,observation_day DESC);
CREATE TABLE patient_doses (
  patient_id uuid NOT NULL REFERENCES local_patients(id), observation_day date NOT NULL,
  dose_id text NOT NULL CHECK (dose_id IN ('one','two')),
  status text NOT NULL CHECK (status IN ('planned','taken','skipped')),
  PRIMARY KEY(patient_id,observation_day,dose_id)
);
ALTER TABLE patient_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE patient_doses ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_doses FORCE ROW LEVEL SECURITY;
CREATE POLICY entries_owner ON patient_entries TO compass_app
  USING (patient_id = nullif(current_setting('app.patient_id',true),'')::uuid)
  WITH CHECK (patient_id = nullif(current_setting('app.patient_id',true),'')::uuid);
CREATE POLICY doses_owner ON patient_doses TO compass_app
  USING (patient_id = nullif(current_setting('app.patient_id',true),'')::uuid)
  WITH CHECK (patient_id = nullif(current_setting('app.patient_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON local_patients,app_sessions,patient_entries,patient_doses TO compass_app;
