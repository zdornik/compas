BEGIN;
SELECT pg_advisory_xact_lock(20261017);
CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE patient_entries DROP CONSTRAINT IF EXISTS patient_entries_type_check;
ALTER TABLE patient_entries ADD CONSTRAINT patient_entries_type_check
  CHECK (type IN ('journal','mood','sleep','assessment','medication-plan','medication-dose','medical-profile'));
INSERT INTO schema_migrations (id) VALUES ('001-medications') ON CONFLICT DO NOTHING;
COMMIT;
