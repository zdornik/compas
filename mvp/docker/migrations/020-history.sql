BEGIN;
SELECT pg_advisory_xact_lock(20261017);
ALTER TABLE local_patients ADD COLUMN IF NOT EXISTS state_revision bigint NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION bump_patient_state_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.local_patients SET state_revision = state_revision + 1
    WHERE id = COALESCE(NEW.patient_id, OLD.patient_id);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION bump_patient_state_revision() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bump_patient_state_revision() TO compass_app;
DROP TRIGGER IF EXISTS entries_state_revision ON patient_entries;
CREATE TRIGGER entries_state_revision AFTER INSERT OR UPDATE OR DELETE ON patient_entries
  FOR EACH ROW EXECUTE FUNCTION bump_patient_state_revision();
DROP TRIGGER IF EXISTS doses_state_revision ON patient_doses;
CREATE TRIGGER doses_state_revision AFTER INSERT OR UPDATE OR DELETE ON patient_doses
  FOR EACH ROW EXECUTE FUNCTION bump_patient_state_revision();
CREATE INDEX IF NOT EXISTS entries_history_idx ON patient_entries(patient_id,type,saved_at DESC,id DESC);
INSERT INTO schema_migrations(id) VALUES ('020-history') ON CONFLICT DO NOTHING;
COMMIT;
