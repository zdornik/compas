SELECT NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE id='010-manual-ingredient-reviews') AS apply_manual_ingredient_migration \gset
\if :apply_manual_ingredient_migration
BEGIN;
SELECT pg_advisory_xact_lock(2026101904);
CREATE TABLE knowledge.manual_ingredient_reviews (
 substance_id text PRIMARY KEY REFERENCES knowledge.substances(id),
 name_en text,translation_kind text NOT NULL CHECK(translation_kind IN ('official_inn','reviewed_synonym','descriptive','unresolved')),
 provider_status text NOT NULL CHECK(provider_status IN ('linked','absent_from_snapshot','composition_incomplete','source_conflict','form_unresolved')),
 components jsonb NOT NULL DEFAULT '[]',evidence jsonb NOT NULL DEFAULT '[]',note text NOT NULL,
 snapshot_sha256 text NOT NULL,reviewed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON knowledge.manual_ingredient_reviews TO compass_app;
INSERT INTO public.schema_migrations(id) VALUES('010-manual-ingredient-reviews');
COMMIT;
\endif
