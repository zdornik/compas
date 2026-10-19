SELECT NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE id='014-chronic-search') AS apply_chronic_search \gset
\if :apply_chronic_search
BEGIN;
SELECT pg_advisory_xact_lock(2026101911);
-- Source-classified search aliases never become disease/ingredient identities.
CREATE TABLE knowledge.substance_search_aliases (
 alias text NOT NULL,substance_id text NOT NULL REFERENCES knowledge.substances(id),
 source_id text NOT NULL REFERENCES knowledge.sources(id),evidence jsonb NOT NULL,
 PRIMARY KEY(alias,substance_id)
);
GRANT SELECT ON knowledge.substance_search_aliases TO compass_app;
INSERT INTO public.schema_migrations(id) VALUES('014-chronic-search');
COMMIT;
\endif
