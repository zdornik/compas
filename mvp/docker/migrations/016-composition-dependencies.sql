SELECT NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE id='016-composition-dependencies') AS apply_composition_dependencies \gset
\if :apply_composition_dependencies
BEGIN;
SELECT pg_advisory_xact_lock(2026101911);
CREATE TABLE knowledge.composition_dependencies (
 combination_id text NOT NULL,component_substance_id text NOT NULL REFERENCES knowledge.substances(id),
 ingredient_id text NOT NULL,provider_id text NOT NULL,
 PRIMARY KEY(combination_id,ingredient_id),UNIQUE(combination_id,component_substance_id),
 FOREIGN KEY(combination_id,ingredient_id) REFERENCES knowledge.registry_components(substance_id,ingredient_id),
 CHECK(combination_id<>component_substance_id)
);
GRANT SELECT ON knowledge.composition_dependencies TO compass_app;
INSERT INTO public.schema_migrations(id) VALUES('016-composition-dependencies');
COMMIT;
\endif
