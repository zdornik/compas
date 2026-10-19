SELECT NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE id='015-instruction-publication') AS apply_instruction_publication \gset
\if :apply_instruction_publication
BEGIN;
SELECT pg_advisory_xact_lock(2026101911);
-- A PDF batch changes availability, not the multilingual naming dictionaries.
CREATE FUNCTION knowledge.refresh_reference_instructions() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(2026101911);
 UPDATE knowledge.catalog_products c SET instruction_document_id=p.instruction_document_id,has_instruction=p.instruction_document_id IS NOT NULL
 FROM knowledge.products p WHERE p.id=c.id AND c.instruction_document_id IS DISTINCT FROM p.instruction_document_id;
 UPDATE knowledge.catalog_substances s SET ready_count=x.ready FROM (
  SELECT s0.id,count(p.id)::int ready FROM knowledge.catalog_substances s0
  LEFT JOIN knowledge.catalog_products p ON p.substance_id=s0.id AND p.selectable AND p.has_instruction GROUP BY s0.id
 ) x WHERE s.id=x.id AND s.ready_count IS DISTINCT FROM x.ready;
 PERFORM knowledge.refresh_reference_status();
END;
$$;
REVOKE ALL ON FUNCTION knowledge.refresh_reference_instructions() FROM PUBLIC;
INSERT INTO public.schema_migrations(id) VALUES('015-instruction-publication');
COMMIT;
\endif
