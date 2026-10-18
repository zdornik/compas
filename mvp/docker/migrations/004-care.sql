SELECT NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE id='004-care') AS apply_care_migration \gset
\if :apply_care_migration
BEGIN;
SELECT pg_advisory_xact_lock(2026101804);
ALTER TABLE app_sessions ADD COLUMN doctor_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE patient_entries DROP CONSTRAINT patient_entries_type_check;
ALTER TABLE patient_entries ADD CONSTRAINT patient_entries_type_check CHECK(type IN ('journal','mood','sleep','assessment','medication-plan','medication-dose','medical-profile'));
CREATE TABLE care_doctors(id uuid PRIMARY KEY REFERENCES local_patients(id),payload bytea NOT NULL);
CREATE TABLE care_invites(token_hash text PRIMARY KEY,patient_id uuid NOT NULL REFERENCES local_patients(id),payload bytea NOT NULL,expires_at timestamptz NOT NULL,used_at timestamptz);
CREATE TABLE care_links(id uuid PRIMARY KEY,patient_id uuid NOT NULL REFERENCES local_patients(id),doctor_id uuid NOT NULL REFERENCES local_patients(id),status text NOT NULL CHECK(status IN ('pending','active','revoked')),payload bytea NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX care_current_link ON care_links(patient_id,doctor_id) WHERE status IN ('pending','active');
CREATE TABLE care_audit(id uuid PRIMARY KEY,patient_id uuid NOT NULL REFERENCES local_patients(id),doctor_id uuid NOT NULL REFERENCES local_patients(id),link_id uuid NOT NULL REFERENCES care_links(id),action text NOT NULL,payload bytea NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE care_doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_doctors FORCE ROW LEVEL SECURITY;
CREATE POLICY doctor_owner ON care_doctors TO compass_app USING(id=nullif(current_setting('app.actor_id',true),'')::uuid) WITH CHECK(id=nullif(current_setting('app.actor_id',true),'')::uuid);
ALTER TABLE care_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_invites FORCE ROW LEVEL SECURITY;
CREATE POLICY invite_access ON care_invites TO compass_app USING(patient_id=nullif(current_setting('app.actor_id',true),'')::uuid OR token_hash=current_setting('app.invite_hash',true)) WITH CHECK(patient_id=nullif(current_setting('app.actor_id',true),'')::uuid OR token_hash=current_setting('app.invite_hash',true));
ALTER TABLE care_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_links FORCE ROW LEVEL SECURITY;
CREATE POLICY link_access ON care_links TO compass_app USING(nullif(current_setting('app.actor_id',true),'')::uuid IN(patient_id,doctor_id)) WITH CHECK(nullif(current_setting('app.actor_id',true),'')::uuid IN(patient_id,doctor_id));
ALTER TABLE care_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_access ON care_audit TO compass_app USING(nullif(current_setting('app.actor_id',true),'')::uuid IN(patient_id,doctor_id)) WITH CHECK(nullif(current_setting('app.actor_id',true),'')::uuid IN(patient_id,doctor_id));
GRANT SELECT,INSERT,UPDATE ON care_doctors,care_invites,care_links TO compass_app;
GRANT SELECT,INSERT ON care_audit TO compass_app;
INSERT INTO schema_migrations(id) VALUES('004-care');
COMMIT;
\endif
