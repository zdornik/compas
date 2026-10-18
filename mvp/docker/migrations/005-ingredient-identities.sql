SELECT NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE id='005-ingredient-identities') AS apply_ingredient_migration \gset
\if :apply_ingredient_migration
BEGIN;
SELECT pg_advisory_xact_lock(2026101805);
-- Public reference identities only. A translated label is not a reviewed provider identity.
CREATE TABLE knowledge.ingredient_entities (
 id text PRIMARY KEY, name_ru text NOT NULL, name_en text NOT NULL,
 chemical_form text NOT NULL, aliases jsonb NOT NULL DEFAULT '[]',
 review_status text NOT NULL DEFAULT 'candidate' CHECK(review_status IN ('candidate','reviewed','rejected')),
 evidence jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(evidence)='array'),
 CHECK(review_status<>'reviewed' OR jsonb_array_length(evidence)>0)
);
CREATE TABLE knowledge.registry_compositions (
 substance_id text PRIMARY KEY REFERENCES knowledge.substances(id),
 expected_components smallint NOT NULL CHECK(expected_components BETWEEN 1 AND 30),
 review_status text NOT NULL DEFAULT 'candidate' CHECK(review_status IN ('candidate','reviewed','rejected')),
 evidence jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(evidence)='array'),
 CHECK(review_status<>'reviewed' OR jsonb_array_length(evidence)>0)
);
CREATE TABLE knowledge.registry_components (
 substance_id text NOT NULL REFERENCES knowledge.registry_compositions(substance_id),
 ingredient_id text NOT NULL REFERENCES knowledge.ingredient_entities(id),
 chemical_form text NOT NULL, relation text NOT NULL CHECK(relation IN ('exact','reviewed_active_moiety','unresolved')),
 review_status text NOT NULL DEFAULT 'candidate' CHECK(review_status IN ('candidate','reviewed','rejected')),
 evidence jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(evidence)='array'),
 PRIMARY KEY(substance_id,ingredient_id),
 CHECK(review_status<>'reviewed' OR (relation<>'unresolved' AND jsonb_array_length(evidence)>0))
);
CREATE TABLE knowledge.provider_ingredients (
 ingredient_id text NOT NULL REFERENCES knowledge.ingredient_entities(id),
 provider text NOT NULL CHECK(provider='ddinter'), external_id text NOT NULL, external_name text NOT NULL,
 review_status text NOT NULL DEFAULT 'candidate' CHECK(review_status IN ('candidate','reviewed','rejected')),
 evidence jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(evidence)='array'),
 PRIMARY KEY(ingredient_id,provider,external_id),
 CHECK(review_status<>'reviewed' OR jsonb_array_length(evidence)>0)
);
GRANT SELECT ON knowledge.ingredient_entities,knowledge.registry_compositions,knowledge.registry_components,knowledge.provider_ingredients TO compass_app;
INSERT INTO public.schema_migrations(id) VALUES('005-ingredient-identities');
COMMIT;
\endif
