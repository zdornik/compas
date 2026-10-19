SELECT NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE id='013-reference-catalog') AS apply_reference_catalog \gset
\if :apply_reference_catalog
BEGIN;
SELECT pg_advisory_xact_lock(2026101911);
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- One shared read catalog in PostgreSQL. Source records and medical identities
-- remain authoritative; fuzzy/trigram similarity never approves an identity.
CREATE TABLE knowledge.catalog_products (
 id text PRIMARY KEY REFERENCES knowledge.products(id) ON DELETE CASCADE,
 registration_number text NOT NULL, registration_search text NOT NULL,
 trade_name text NOT NULL, inn text NOT NULL, form text NOT NULL,
 source_status text NOT NULL, substance_id text, instruction_document_id text,
 holder text, psychiatry boolean NOT NULL, active boolean NOT NULL,
 selectable boolean NOT NULL, has_instruction boolean NOT NULL, search_vector tsvector NOT NULL
);
CREATE INDEX catalog_product_fts ON knowledge.catalog_products USING gin(search_vector);
CREATE INDEX catalog_trade_trgm ON knowledge.catalog_products USING gin(trade_name public.gin_trgm_ops);
CREATE INDEX catalog_inn_trgm ON knowledge.catalog_products USING gin(inn public.gin_trgm_ops);
CREATE INDEX catalog_registration_trgm ON knowledge.catalog_products USING gin(registration_search public.gin_trgm_ops);
CREATE INDEX catalog_browse ON knowledge.catalog_products(has_instruction DESC,trade_name,registration_number,id);
CREATE INDEX catalog_browse_active ON knowledge.catalog_products(has_instruction DESC,trade_name,registration_number,id) WHERE active;
CREATE INDEX catalog_browse_psychiatry ON knowledge.catalog_products(has_instruction DESC,trade_name,registration_number,id) WHERE psychiatry;
CREATE INDEX catalog_browse_psychiatry_active ON knowledge.catalog_products(has_instruction DESC,trade_name,registration_number,id) WHERE psychiatry AND active;
CREATE INDEX catalog_substance_products ON knowledge.catalog_products(substance_id,has_instruction DESC,trade_name,registration_number,id) WHERE selectable;
CREATE INDEX catalog_substance_all ON knowledge.catalog_products(substance_id);
CREATE TABLE knowledge.catalog_substances (
 id text PRIMARY KEY REFERENCES knowledge.substances(id) ON DELETE CASCADE,
 name_ru text NOT NULL,name_en text,product_count integer NOT NULL,ready_count integer NOT NULL
);
CREATE TABLE knowledge.catalog_terms (
 substance_id text NOT NULL REFERENCES knowledge.substances(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('registry_ru','registry_en','nsi_name')),
 term text NOT NULL,PRIMARY KEY(substance_id,kind,term)
);
CREATE INDEX catalog_terms_trgm ON knowledge.catalog_terms USING gin(term public.gin_trgm_ops);
CREATE TABLE knowledge.catalog_state (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),generation bigint NOT NULL,
 refreshed_at timestamptz NOT NULL,counts jsonb NOT NULL,sources jsonb NOT NULL,totals jsonb NOT NULL
);

CREATE FUNCTION knowledge.refresh_reference_status() RETURNS void LANGUAGE plpgsql AS $$
DECLARE counts_value jsonb;sources_value jsonb;totals_value jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(2026101911);
 SELECT to_jsonb(x) INTO counts_value FROM (SELECT
  (SELECT count(*)::int FROM knowledge.documents WHERE kind='clinical_recommendation') "clinicalDocuments",
  (SELECT count(*)::int FROM knowledge.documents WHERE kind='drug_instruction') "instructionDocuments",
  (SELECT count(*)::int FROM knowledge.pages) pages,
  (SELECT count(*)::int FROM knowledge.products) products,
  (SELECT count(*)::int FROM knowledge.substances) substances,
  (SELECT count(*)::int FROM knowledge.mentions) mentions,
  (SELECT count(*)::int FROM knowledge.interactions) interactions,
  (SELECT count(*)::int FROM knowledge.registry_compositions WHERE review_status='reviewed') "mappedSubstances",
  (SELECT count(*)::int FROM knowledge.substances WHERE name_en IS NOT NULL) "translatedSubstances",
  (SELECT count(*)::int FROM knowledge.inn_terms) "officialInnTerms",
  (SELECT count(*)::int FROM knowledge.nsi_drug_terms t JOIN knowledge.nsi_drug_snapshots z ON z.id=t.snapshot_id AND z.active) "nsiDrugTerms",
  (SELECT (manifest->'counts'->>'uniqueKlpCodes')::int FROM knowledge.esklp_snapshots WHERE active) "esklpKlpPositions",
  (SELECT count(DISTINCT d.id)::int FROM knowledge.documents d JOIN knowledge.product_documents x ON x.document_id=d.id JOIN knowledge.products p ON p.id=x.product_id WHERE p.metadata->>'collectionScope'='psychiatry') "psychiatryInstructions",
  (SELECT count(DISTINCT registration_number)::int FROM knowledge.products WHERE metadata->>'collectionScope'='psychiatry') "psychiatryRegistrations",
  (SELECT count(DISTINCT registration_number)::int FROM knowledge.products WHERE metadata->>'collectionScope'='psychiatry' AND instruction_document_id IS NOT NULL) "psychiatryRegistrationsReady") x;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) INTO sources_value FROM (
  SELECT id,name,url,license,coverage,retrieved_at AS "retrievedAt",jsonb_build_object('snapshotDate',metadata->'snapshotDate','status',metadata->'status','instructionProgress',metadata->'instructionProgress','selectedTotal',metadata->'selectedTotal','catalogTotal',metadata->'catalogTotal','psychiatryScope',metadata->'psychiatryScope') metadata FROM knowledge.sources) x;
 SELECT jsonb_build_object('all',count(*)::int,'active',count(*) FILTER(WHERE active)::int,'psychiatry',count(*) FILTER(WHERE psychiatry)::int,'psychiatryActive',count(*) FILTER(WHERE psychiatry AND active)::int) INTO totals_value FROM knowledge.catalog_products;
 INSERT INTO knowledge.catalog_state(singleton,generation,refreshed_at,counts,sources,totals) VALUES(true,1,now(),counts_value,sources_value,totals_value)
 ON CONFLICT(singleton) DO UPDATE SET generation=knowledge.catalog_state.generation+1,refreshed_at=EXCLUDED.refreshed_at,counts=EXCLUDED.counts,sources=EXCLUDED.sources,totals=EXCLUDED.totals;
END;
$$;
CREATE FUNCTION knowledge.refresh_reference_catalog() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(2026101911);
 INSERT INTO knowledge.catalog_products AS c
 SELECT p.id,p.registration_number,normalize(p.registration_number,NFKC),p.trade_name,p.inn,p.form,p.source_status,p.substance_id,p.instruction_document_id,p.metadata->>'holder',coalesce(p.metadata->>'collectionScope'='psychiatry',false),
 p.source_status IN ('Действующий','Выдано по правилам ЕАЭС','Действует на подтверждении государственной регистрации','Действует в иностранных упаковках'),
 p.form !~* 'субстанц' AND p.source_status IN ('Действующий','Выдано по правилам ЕАЭС','Действует на подтверждении государственной регистрации','Действует в иностранных упаковках'),
 p.instruction_document_id IS NOT NULL,p.search_vector FROM knowledge.products p
 ON CONFLICT(id) DO UPDATE SET registration_number=EXCLUDED.registration_number,registration_search=EXCLUDED.registration_search,trade_name=EXCLUDED.trade_name,inn=EXCLUDED.inn,form=EXCLUDED.form,source_status=EXCLUDED.source_status,substance_id=EXCLUDED.substance_id,instruction_document_id=EXCLUDED.instruction_document_id,holder=EXCLUDED.holder,psychiatry=EXCLUDED.psychiatry,active=EXCLUDED.active,selectable=EXCLUDED.selectable,has_instruction=EXCLUDED.has_instruction,search_vector=EXCLUDED.search_vector
 WHERE ROW(c.registration_number,c.registration_search,c.trade_name,c.inn,c.form,c.source_status,c.substance_id,c.instruction_document_id,c.holder,c.psychiatry,c.active,c.selectable,c.has_instruction,c.search_vector) IS DISTINCT FROM ROW(EXCLUDED.registration_number,EXCLUDED.registration_search,EXCLUDED.trade_name,EXCLUDED.inn,EXCLUDED.form,EXCLUDED.source_status,EXCLUDED.substance_id,EXCLUDED.instruction_document_id,EXCLUDED.holder,EXCLUDED.psychiatry,EXCLUDED.active,EXCLUDED.selectable,EXCLUDED.has_instruction,EXCLUDED.search_vector);
 DELETE FROM knowledge.catalog_products c WHERE NOT EXISTS(SELECT 1 FROM knowledge.products p WHERE p.id=c.id);
 INSERT INTO knowledge.catalog_substances AS c
 SELECT s.id,s.name_ru,s.name_en,count(p.id) FILTER(WHERE p.selectable)::int,count(p.id) FILTER(WHERE p.selectable AND p.has_instruction)::int FROM knowledge.substances s LEFT JOIN knowledge.catalog_products p ON p.substance_id=s.id GROUP BY s.id
 ON CONFLICT(id) DO UPDATE SET name_ru=EXCLUDED.name_ru,name_en=EXCLUDED.name_en,product_count=EXCLUDED.product_count,ready_count=EXCLUDED.ready_count
 WHERE ROW(c.name_ru,c.name_en,c.product_count,c.ready_count) IS DISTINCT FROM ROW(EXCLUDED.name_ru,EXCLUDED.name_en,EXCLUDED.product_count,EXCLUDED.ready_count);
 DELETE FROM knowledge.catalog_substances c WHERE NOT EXISTS(SELECT 1 FROM knowledge.substances s WHERE s.id=c.id);
 -- MVCC keeps the previous complete term set visible to readers until commit.
 DELETE FROM knowledge.catalog_terms;
 INSERT INTO knowledge.catalog_terms
 SELECT id,'registry_ru',name_ru FROM knowledge.substances
 UNION SELECT id,'registry_en',name_en FROM knowledge.substances WHERE name_en IS NOT NULL
 UNION SELECT l.substance_id,'nsi_name',v.term FROM knowledge.nsi_substance_terms l JOIN knowledge.nsi_drug_terms t ON t.snapshot_id=l.snapshot_id AND t.code=l.term_code JOIN knowledge.nsi_drug_snapshots z ON z.id=t.snapshot_id AND z.active
 CROSS JOIN LATERAL unnest(ARRAY[t.name_en,t.name_la,t.name_la_genitive]||t.alternatives) v(term) WHERE v.term IS NOT NULL;
 PERFORM knowledge.refresh_reference_status();
 ANALYZE knowledge.catalog_products;
 ANALYZE knowledge.catalog_substances;
 ANALYZE knowledge.catalog_terms;
END;
$$;
-- Runtime cannot rebuild, mutate or promote any source/mapping. Only the offline
-- import role publishes a complete catalog together with its source transaction.
REVOKE ALL ON FUNCTION knowledge.refresh_reference_catalog() FROM PUBLIC;
REVOKE ALL ON FUNCTION knowledge.refresh_reference_status() FROM PUBLIC;
GRANT SELECT ON knowledge.catalog_products,knowledge.catalog_substances,knowledge.catalog_terms,knowledge.catalog_state TO compass_app;
SELECT knowledge.refresh_reference_catalog();
INSERT INTO public.schema_migrations(id) VALUES('013-reference-catalog');
COMMIT;
\endif
