SELECT NOT EXISTS(SELECT 1 FROM schema_migrations WHERE id='006-reference-catalogs') AS apply_catalogs \gset
\if :apply_catalogs
BEGIN;
SELECT pg_advisory_xact_lock(2026101806);
CREATE TABLE knowledge.conditions (
 code text PRIMARY KEY, name_ru text NOT NULL, name_en text, parent_code text,
 source_id text NOT NULL REFERENCES knowledge.sources(id),source_version text NOT NULL,source_url text NOT NULL,
 source_sha256 text NOT NULL,metadata jsonb NOT NULL DEFAULT '{}',
 search_vector tsvector GENERATED ALWAYS AS (to_tsvector('russian',name_ru)) STORED
);
CREATE INDEX conditions_search ON knowledge.conditions USING gin(search_vector);
CREATE TABLE knowledge.source_drugs (
 source_id text NOT NULL REFERENCES knowledge.sources(id),id text NOT NULL,name text NOT NULL,rxcui text,atc text[] NOT NULL DEFAULT '{}',metadata jsonb NOT NULL DEFAULT '{}',PRIMARY KEY(source_id,id)
);
CREATE TABLE knowledge.disease_interactions (
 id text PRIMARY KEY,source_id text NOT NULL REFERENCES knowledge.sources(id),drug_id text NOT NULL,condition_name text NOT NULL,severity text NOT NULL,note text,references_json jsonb NOT NULL DEFAULT '[]',source_url text NOT NULL,source_sha256 text NOT NULL,
 clinical_use_approved boolean NOT NULL DEFAULT false,metadata jsonb NOT NULL DEFAULT '{}',FOREIGN KEY(source_id,drug_id) REFERENCES knowledge.source_drugs(source_id,id)
);
CREATE INDEX disease_interactions_drug ON knowledge.disease_interactions(source_id,drug_id);
CREATE TABLE knowledge.condition_mappings (
 code text NOT NULL REFERENCES knowledge.conditions(code),source_id text NOT NULL REFERENCES knowledge.sources(id),condition_name text NOT NULL,
 relation text NOT NULL CHECK(relation IN ('exact','broader_group')),review_status text NOT NULL CHECK(review_status IN ('candidate','source_verified','rejected')),
 evidence jsonb NOT NULL DEFAULT '[]',PRIMARY KEY(code,source_id,condition_name)
);
GRANT SELECT ON knowledge.conditions,knowledge.source_drugs,knowledge.disease_interactions,knowledge.condition_mappings TO compass_app;
CREATE TABLE care_patient_profiles(patient_id uuid PRIMARY KEY REFERENCES local_patients(id),code_hash text NOT NULL UNIQUE,payload bytea NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE care_patient_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_patient_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY profile_access ON care_patient_profiles TO compass_app USING(patient_id=nullif(current_setting('app.actor_id',true),'')::uuid OR code_hash=current_setting('app.invite_hash',true)) WITH CHECK(patient_id=nullif(current_setting('app.actor_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON care_patient_profiles TO compass_app;
INSERT INTO schema_migrations(id) VALUES('006-reference-catalogs');
COMMIT;
\endif
