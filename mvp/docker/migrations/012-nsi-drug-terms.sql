SELECT NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE id='012-nsi-drug-terms') AS apply_nsi_drug_migration \gset
\if :apply_nsi_drug_migration
BEGIN;
SELECT pg_advisory_xact_lock(2026101908);
CREATE TABLE knowledge.nsi_drug_snapshots (
 id text PRIMARY KEY CHECK(id ~ '^[a-f0-9]{64}$'), oid text NOT NULL, version text NOT NULL,
 active boolean NOT NULL DEFAULT false, manifest jsonb NOT NULL, imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX nsi_drug_one_active ON knowledge.nsi_drug_snapshots(active) WHERE active;
CREATE TABLE knowledge.nsi_drug_terms (
 snapshot_id text NOT NULL REFERENCES knowledge.nsi_drug_snapshots(id), code text NOT NULL,
 version text NOT NULL, name_ru text NOT NULL, name_en text, name_la text, name_la_genitive text,
 alternatives text[] NOT NULL, group_code text NOT NULL, inn_rf text NOT NULL,
 atc text[] NOT NULL, sctid text, source_row integer NOT NULL,
 PRIMARY KEY(snapshot_id,code)
);
CREATE INDEX nsi_drug_name_idx ON knowledge.nsi_drug_terms(knowledge.esklp_name_key(name_ru));
CREATE TABLE knowledge.nsi_substance_terms (
 substance_id text NOT NULL REFERENCES knowledge.substances(id), snapshot_id text NOT NULL,
 term_code text NOT NULL, relation text NOT NULL CHECK(relation IN ('exact_primary','source_alternative')),
 PRIMARY KEY(substance_id,snapshot_id,term_code),
 FOREIGN KEY(snapshot_id,term_code) REFERENCES knowledge.nsi_drug_terms(snapshot_id,code)
);
GRANT SELECT ON knowledge.nsi_drug_snapshots,knowledge.nsi_drug_terms,knowledge.nsi_substance_terms TO compass_app;
INSERT INTO public.schema_migrations(id) VALUES('012-nsi-drug-terms');
COMMIT;
\endif
