SELECT NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE id='011-esklp') AS apply_esklp_migration \gset
\if :apply_esklp_migration
BEGIN;
SELECT pg_advisory_xact_lock(2026101906);
CREATE FUNCTION knowledge.esklp_name_key(value text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT lower(btrim(regexp_replace(normalize(value,NFC),'\s+',' ','g'))) $$;
CREATE FUNCTION knowledge.esklp_trade_key(value text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT knowledge.esklp_name_key(translate(value,'®™','')) $$;
CREATE TABLE knowledge.esklp_snapshots (
 id text PRIMARY KEY CHECK(id ~ '^[a-f0-9]{64}$'), snapshot_date date NOT NULL,
 active boolean NOT NULL DEFAULT false, manifest jsonb NOT NULL, imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX esklp_one_active_snapshot ON knowledge.esklp_snapshots(active) WHERE active;
CREATE TABLE knowledge.esklp_smnn (
 snapshot_id text NOT NULL REFERENCES knowledge.esklp_snapshots(id), code text NOT NULL,
 name_ru text NOT NULL, form text NOT NULL, dosage text NOT NULL, atc text NOT NULL,
 normalized_names text NOT NULL, invalid_data text NOT NULL, valid_from date, valid_until date,
 workbook text NOT NULL, source_row integer NOT NULL CHECK(source_row>=5), PRIMARY KEY(snapshot_id,code)
);
CREATE TABLE knowledge.esklp_klp (
 snapshot_id text NOT NULL REFERENCES knowledge.esklp_snapshots(id), workbook text NOT NULL,
 source_row integer NOT NULL CHECK(source_row>=6), code text NOT NULL, smnn_code text NOT NULL,
 name_ru text NOT NULL, normalized_inn text NOT NULL, trade_name text NOT NULL,
 form text NOT NULL, dosage text NOT NULL, registration_number text NOT NULL, holder text NOT NULL,
 invalid_data text NOT NULL, valid_from date, valid_until date,
 PRIMARY KEY(snapshot_id,workbook,source_row)
);
CREATE INDEX esklp_klp_code_idx ON knowledge.esklp_klp(snapshot_id,code);
CREATE INDEX esklp_klp_registration_idx ON knowledge.esklp_klp(snapshot_id,registration_number,knowledge.esklp_trade_key(trade_name));
CREATE TABLE knowledge.esklp_trade_names (
 snapshot_id text NOT NULL REFERENCES knowledge.esklp_snapshots(id), source_row integer NOT NULL CHECK(source_row>=5),
 smnn_code text NOT NULL, trade_name text NOT NULL, registration_number text NOT NULL,
 name_ru text NOT NULL, form text NOT NULL, dosage text NOT NULL, normalized_names text NOT NULL,
 workbook text NOT NULL, PRIMARY KEY(snapshot_id,source_row)
);
CREATE TABLE knowledge.esklp_product_links (
 snapshot_id text NOT NULL REFERENCES knowledge.esklp_snapshots(id), product_id text NOT NULL REFERENCES knowledge.products(id),
 klp_code text NOT NULL, smnn_code text NOT NULL, normalized_inn text NOT NULL,
 match_status text NOT NULL CHECK(match_status IN ('exact_registry_inn','name_difference')),
 PRIMARY KEY(snapshot_id,product_id,klp_code)
);
CREATE INDEX esklp_links_product_idx ON knowledge.esklp_product_links(product_id,snapshot_id);
CREATE INDEX esklp_links_code_idx ON knowledge.esklp_product_links(klp_code);
CREATE INDEX esklp_links_smnn_idx ON knowledge.esklp_product_links(smnn_code);
GRANT SELECT ON knowledge.esklp_snapshots,knowledge.esklp_smnn,knowledge.esklp_klp,knowledge.esklp_trade_names,knowledge.esklp_product_links TO compass_app;
INSERT INTO public.schema_migrations(id) VALUES('011-esklp');
COMMIT;
\endif
