SELECT EXISTS(SELECT 1 FROM public.schema_migrations WHERE id='007-eaeu-inn') AS applied \gset
\if :applied
\else
BEGIN;
CREATE TABLE knowledge.inn_terms(
 code text PRIMARY KEY,
 name_ru text NOT NULL,
 name_en text NOT NULL,
 name_la text,
 source_id text NOT NULL REFERENCES knowledge.sources(id),
 source_sha256 text NOT NULL,
 metadata jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX inn_terms_en ON knowledge.inn_terms(lower(name_en));
CREATE INDEX inn_terms_ru ON knowledge.inn_terms(lower(name_ru));
GRANT SELECT ON knowledge.inn_terms TO compass_app;
INSERT INTO public.schema_migrations(id) VALUES('007-eaeu-inn');
COMMIT;
\endif
