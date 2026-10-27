SELECT NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE id='021-care-tracking') AS apply_care_tracking \gset
\if :apply_care_tracking
BEGIN;
SELECT pg_advisory_xact_lock(2026102701);
-- Batch roster reads are enabled only within their own transaction. Normal patient reads retain their single-patient scope.
CREATE POLICY roster_entries ON patient_entries FOR SELECT TO compass_app USING(
 current_setting('app.roster_doctor',true)=current_setting('app.actor_id',true)
 AND nullif(current_setting('app.roster_doctor',true),'') IS NOT NULL
 AND type IN ('medical-profile','medication-plan','medication-dose','mood','sleep','assessment')
 AND EXISTS(SELECT 1 FROM care_links l WHERE l.patient_id=patient_entries.patient_id AND l.doctor_id=nullif(current_setting('app.actor_id',true),'')::uuid AND l.status='active')
);
CREATE POLICY roster_accounts ON auth_accounts FOR SELECT TO compass_app USING(
 current_setting('app.roster_doctor',true)=current_setting('app.actor_id',true)
 AND nullif(current_setting('app.roster_doctor',true),'') IS NOT NULL
 AND EXISTS(SELECT 1 FROM care_links l WHERE l.patient_id=auth_accounts.principal_id AND l.doctor_id=nullif(current_setting('app.actor_id',true),'')::uuid AND l.status='active')
);
CREATE TABLE care_clinical_notes(
 id uuid PRIMARY KEY,link_id uuid NOT NULL REFERENCES care_links(id),patient_id uuid NOT NULL REFERENCES local_patients(id),doctor_id uuid NOT NULL REFERENCES local_patients(id),
 revision integer NOT NULL CHECK(revision>0),payload bytea NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,link_id,doctor_id)
);
CREATE INDEX care_clinical_notes_list ON care_clinical_notes(link_id,doctor_id,updated_at DESC,id DESC);
CREATE TABLE care_clinical_note_versions(
 note_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),link_id uuid NOT NULL REFERENCES care_links(id),doctor_id uuid NOT NULL REFERENCES local_patients(id),payload bytea NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(note_id,revision),FOREIGN KEY(note_id,link_id,doctor_id) REFERENCES care_clinical_notes(id,link_id,doctor_id)
);
ALTER TABLE care_clinical_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_clinical_notes FORCE ROW LEVEL SECURITY;
ALTER TABLE care_clinical_note_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_clinical_note_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY clinical_note_owner ON care_clinical_notes TO compass_app USING(
 doctor_id=nullif(current_setting('app.actor_id',true),'')::uuid AND EXISTS(SELECT 1 FROM care_links l WHERE l.id=link_id AND l.doctor_id=care_clinical_notes.doctor_id AND l.patient_id=care_clinical_notes.patient_id AND l.status='active')
) WITH CHECK(doctor_id=nullif(current_setting('app.actor_id',true),'')::uuid AND EXISTS(SELECT 1 FROM care_links l WHERE l.id=link_id AND l.doctor_id=care_clinical_notes.doctor_id AND l.patient_id=care_clinical_notes.patient_id AND l.status='active'));
CREATE POLICY clinical_version_owner ON care_clinical_note_versions TO compass_app USING(
 doctor_id=nullif(current_setting('app.actor_id',true),'')::uuid AND EXISTS(SELECT 1 FROM care_links l WHERE l.id=link_id AND l.doctor_id=care_clinical_note_versions.doctor_id AND l.status='active')
) WITH CHECK(doctor_id=nullif(current_setting('app.actor_id',true),'')::uuid AND EXISTS(SELECT 1 FROM care_links l WHERE l.id=link_id AND l.doctor_id=care_clinical_note_versions.doctor_id AND l.status='active'));
GRANT SELECT,INSERT,UPDATE ON care_clinical_notes TO compass_app;
GRANT SELECT,INSERT ON care_clinical_note_versions TO compass_app;
INSERT INTO public.schema_migrations(id) VALUES('021-care-tracking');
COMMIT;
\endif
