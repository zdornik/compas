SELECT NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE id='002-knowledge') AS apply_reference_migration \gset
\if :apply_reference_migration
BEGIN;
SELECT pg_advisory_xact_lock(20261018);
CREATE SCHEMA IF NOT EXISTS knowledge;
REVOKE CREATE ON SCHEMA knowledge FROM PUBLIC;
GRANT USAGE ON SCHEMA knowledge TO compass_app;
CREATE TABLE IF NOT EXISTS knowledge.sources (
 id text PRIMARY KEY, name text NOT NULL, url text NOT NULL, license text NOT NULL,
 usage_scope text NOT NULL DEFAULT 'local_research', coverage text NOT NULL,
 retrieved_at timestamptz, metadata jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS knowledge.documents (
 id text PRIMARY KEY, source_id text NOT NULL REFERENCES knowledge.sources(id), kind text NOT NULL
 CHECK(kind IN ('clinical_recommendation','drug_instruction')), external_id text NOT NULL,
 title text NOT NULL, version text NOT NULL, source_url text NOT NULL, landing_url text NOT NULL,
 source_status text NOT NULL, icd10 text[] NOT NULL DEFAULT '{}', age_category text,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), mime_type text NOT NULL DEFAULT 'application/pdf',
 original bytea NOT NULL, retrieved_at timestamptz NOT NULL, publication_date text,
 review_status text NOT NULL DEFAULT 'source_document', clinical_use_approved boolean NOT NULL DEFAULT false,
 metadata jsonb NOT NULL DEFAULT '{}', UNIQUE(source_id,external_id,version)
);
CREATE INDEX IF NOT EXISTS kb_documents_icd_idx ON knowledge.documents USING gin(icd10);
CREATE TABLE IF NOT EXISTS knowledge.pages (
 document_id text NOT NULL REFERENCES knowledge.documents(id), page integer NOT NULL CHECK(page>0),
 text_content text NOT NULL, search_vector tsvector GENERATED ALWAYS AS (to_tsvector('russian',text_content)) STORED,
 PRIMARY KEY(document_id,page)
);
CREATE INDEX IF NOT EXISTS kb_pages_search_idx ON knowledge.pages USING gin(search_vector);
CREATE TABLE IF NOT EXISTS knowledge.substances (
 id text PRIMARY KEY, name_ru text NOT NULL, name_en text, normalized_name text NOT NULL,
 source_id text NOT NULL REFERENCES knowledge.sources(id), kind text NOT NULL,
 mapping_status text NOT NULL DEFAULT 'unreviewed', metadata jsonb NOT NULL DEFAULT '{}',
 UNIQUE(source_id,normalized_name)
);
CREATE TABLE IF NOT EXISTS knowledge.products (
 id text PRIMARY KEY, source_id text NOT NULL REFERENCES knowledge.sources(id),
 registration_number text NOT NULL, trade_name text NOT NULL, inn text NOT NULL,
 substance_id text REFERENCES knowledge.substances(id), form text NOT NULL DEFAULT '', source_status text NOT NULL,
 instruction_document_id text REFERENCES knowledge.documents(id), metadata jsonb NOT NULL DEFAULT '{}',
 search_vector tsvector GENERATED ALWAYS AS(to_tsvector('russian', trade_name || ' ' || inn || ' ' || registration_number)) STORED
);
CREATE INDEX IF NOT EXISTS kb_products_search_idx ON knowledge.products USING gin(search_vector);
CREATE INDEX IF NOT EXISTS kb_products_substance_idx ON knowledge.products(substance_id);
CREATE TABLE IF NOT EXISTS knowledge.product_documents (
 product_id text NOT NULL REFERENCES knowledge.products(id),
 document_id text NOT NULL REFERENCES knowledge.documents(id),
 relation text NOT NULL DEFAULT 'instruction_for_registration',
 PRIMARY KEY(product_id,document_id)
);
CREATE TABLE IF NOT EXISTS knowledge.mentions (
 document_id text NOT NULL, page integer NOT NULL, substance_id text NOT NULL REFERENCES knowledge.substances(id),
 start_offset integer NOT NULL CHECK(start_offset>=0), matched_text text NOT NULL,
 context text NOT NULL, method text NOT NULL DEFAULT 'exact_registry_name',
 review_status text NOT NULL DEFAULT 'unreviewed_mention',
 FOREIGN KEY(document_id,page) REFERENCES knowledge.pages(document_id,page),
 PRIMARY KEY(document_id,page,substance_id,start_offset)
);
CREATE INDEX IF NOT EXISTS kb_mentions_substance_idx ON knowledge.mentions(substance_id);
CREATE TABLE IF NOT EXISTS knowledge.interactions (
 id text PRIMARY KEY, source_id text NOT NULL REFERENCES knowledge.sources(id),
 source_drug_a_id text NOT NULL, source_drug_b_id text NOT NULL,
 drug_a_name text NOT NULL, drug_b_name text NOT NULL,
 substance_a_id text REFERENCES knowledge.substances(id), substance_b_id text REFERENCES knowledge.substances(id),
 source_severity text NOT NULL, mechanism text, management text, evidence jsonb NOT NULL DEFAULT '[]',
 source_url text NOT NULL, source_sha256 text NOT NULL,
 review_status text NOT NULL DEFAULT 'source_only', clinical_use_approved boolean NOT NULL DEFAULT false,
 metadata jsonb NOT NULL DEFAULT '{}', CHECK(source_drug_a_id < source_drug_b_id),
 UNIQUE(source_id,source_drug_a_id,source_drug_b_id)
);
CREATE INDEX IF NOT EXISTS kb_interaction_pair_idx ON knowledge.interactions(substance_a_id,substance_b_id);
CREATE TABLE IF NOT EXISTS knowledge.import_runs (
 id text PRIMARY KEY, started_at timestamptz NOT NULL, finished_at timestamptz,
 status text NOT NULL, counts jsonb NOT NULL DEFAULT '{}', errors jsonb NOT NULL DEFAULT '[]'
);
-- Runtime only reads public reference data. Patient identities/data have no foreign keys here.
GRANT SELECT ON ALL TABLES IN SCHEMA knowledge TO compass_app;
-- A separate importer uses the existing local admin secret only at the CLI; no web write routes.
INSERT INTO schema_migrations(id) VALUES('002-knowledge') ON CONFLICT DO NOTHING;
COMMIT;

\endif
