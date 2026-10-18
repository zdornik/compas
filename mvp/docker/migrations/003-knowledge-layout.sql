SELECT NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE id='003-knowledge-layout') AS apply_reference_migration \gset
\if :apply_reference_migration
BEGIN;
SELECT pg_advisory_xact_lock(20261018);
ALTER TABLE knowledge.pages ADD COLUMN IF NOT EXISTS layout jsonb;
CREATE TABLE IF NOT EXISTS knowledge.page_assets (
 document_id text NOT NULL,
 page integer NOT NULL,
 id text NOT NULL CHECK (id ~ '^[a-f0-9]{32}$'),
 mime_type text NOT NULL CHECK(mime_type='image/png'),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 original bytea NOT NULL,
 PRIMARY KEY(document_id,id),
 FOREIGN KEY(document_id,page) REFERENCES knowledge.pages(document_id,page) ON DELETE CASCADE
);
GRANT SELECT ON knowledge.page_assets TO compass_app;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON knowledge.page_assets FROM compass_app;
INSERT INTO public.schema_migrations(id) VALUES ('003-knowledge-layout') ON CONFLICT DO NOTHING;
COMMIT;

\endif
