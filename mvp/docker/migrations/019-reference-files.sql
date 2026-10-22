SELECT NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE id='019-reference-files') AS apply_reference_files \gset
\if :apply_reference_files
BEGIN;
SELECT pg_advisory_xact_lock(2026102019);
-- Legacy snapshots may still supply bytea. Only the offline publisher may evict it.
ALTER TABLE knowledge.documents ALTER COLUMN original DROP NOT NULL;
ALTER TABLE knowledge.page_assets ALTER COLUMN original DROP NOT NULL;
ALTER TABLE knowledge.documents ADD COLUMN blob_key text, ADD COLUMN original_bytes bigint, ADD COLUMN archive_verified_at timestamptz;
ALTER TABLE knowledge.page_assets ADD COLUMN blob_key text, ADD COLUMN original_bytes bigint, ADD COLUMN archive_verified_at timestamptz;
ALTER TABLE knowledge.documents ADD CONSTRAINT document_binary_present CHECK (
 (blob_key IS NULL AND original IS NOT NULL) OR
 (blob_key IS NOT NULL AND original_bytes IS NOT NULL AND blob_key=sha256 AND blob_key ~ '^[a-f0-9]{64}$' AND original_bytes>0 AND archive_verified_at IS NOT NULL));
ALTER TABLE knowledge.page_assets ADD CONSTRAINT page_asset_binary_present CHECK (
 (blob_key IS NULL AND original IS NOT NULL) OR
 (blob_key IS NOT NULL AND original_bytes IS NOT NULL AND blob_key=sha256 AND blob_key ~ '^[a-f0-9]{64}$' AND original_bytes>0 AND archive_verified_at IS NOT NULL));
CREATE TABLE knowledge.reader_indexes (
 document_id text PRIMARY KEY REFERENCES knowledge.documents(id) ON DELETE CASCADE,
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 revision text NOT NULL CHECK(revision ~ '^[a-f0-9]{64}$'),
 manifest jsonb NOT NULL, published_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE knowledge.pages ADD COLUMN reader_search text;
GRANT SELECT ON knowledge.reader_indexes TO compass_app;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON knowledge.reader_indexes FROM compass_app;
INSERT INTO public.schema_migrations(id) VALUES('019-reference-files');
COMMIT;
\endif
