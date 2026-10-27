SELECT NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE id='017-journal') AS apply_journal \gset
\if :apply_journal
BEGIN;
SELECT pg_advisory_xact_lock(2026102001);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='compass_journal_service') THEN CREATE ROLE compass_journal_service NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='compass_journal_worker') THEN CREATE ROLE compass_journal_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;END IF;
END $$;
CREATE TABLE public.journal_notes(
 patient_id uuid NOT NULL, entry_id text NOT NULL, current_revision integer NOT NULL CHECK(current_revision>0),
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(patient_id,entry_id),
 FOREIGN KEY(patient_id,entry_id) REFERENCES public.patient_entries(patient_id,id)
);
CREATE TABLE public.journal_note_revisions(
 patient_id uuid NOT NULL,entry_id text NOT NULL,revision integer NOT NULL CHECK(revision>0),
 payload bytea NOT NULL,cipher_context text NOT NULL,key_id text NOT NULL DEFAULT 'local-v1',
 observation_day date NOT NULL,saved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(patient_id,entry_id,revision),FOREIGN KEY(patient_id,entry_id) REFERENCES public.journal_notes(patient_id,entry_id)
);
ALTER TABLE public.journal_notes ADD CONSTRAINT journal_current_revision FOREIGN KEY(patient_id,entry_id,current_revision)
 REFERENCES public.journal_note_revisions(patient_id,entry_id,revision) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE public.journal_mutation_receipts(
 patient_id uuid NOT NULL,mutation_id uuid NOT NULL,entry_id text NOT NULL,saved_revision integer NOT NULL,fingerprint text NOT NULL,
 PRIMARY KEY(patient_id,mutation_id),FOREIGN KEY(patient_id,entry_id,saved_revision) REFERENCES public.journal_note_revisions(patient_id,entry_id,revision)
);
CREATE TABLE public.journal_access_guard(
 patient_id uuid PRIMARY KEY REFERENCES public.local_patients(id),health_data boolean NOT NULL,processing boolean NOT NULL,
 sharing boolean NOT NULL,ai_enabled boolean NOT NULL,policy_version text,authorization_epoch integer NOT NULL DEFAULT 1
);
CREATE TABLE public.journal_analysis_jobs(
 id uuid PRIMARY KEY,patient_id uuid NOT NULL,entry_id text NOT NULL,revision integer NOT NULL,
 spec_id text NOT NULL CHECK(spec_id='stub-v1'),authorization_epoch integer NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','running','retry_wait','succeeded','failed','cancelled')),
 attempts integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,lease_token uuid,
 error_code text,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 FOREIGN KEY(patient_id,entry_id,revision) REFERENCES public.journal_note_revisions(patient_id,entry_id,revision),
 UNIQUE(patient_id,entry_id,revision,spec_id,authorization_epoch)
);
CREATE TABLE public.journal_note_analyses(
 job_id uuid PRIMARY KEY REFERENCES public.journal_analysis_jobs(id),patient_id uuid NOT NULL,entry_id text NOT NULL,revision integer NOT NULL,
 payload bytea NOT NULL,key_id text NOT NULL DEFAULT 'local-v1',signal_level text NOT NULL CHECK(signal_level IN('routine','elevated','urgent','indeterminate')),
 created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(patient_id,entry_id,revision) REFERENCES public.journal_note_revisions(patient_id,entry_id,revision)
);
CREATE TABLE public.doctor_note_alerts(
 id uuid PRIMARY KEY,analysis_id uuid NOT NULL REFERENCES public.journal_note_analyses(job_id),patient_id uuid NOT NULL,
 care_link_id uuid NOT NULL REFERENCES public.care_links(id),doctor_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN('signal','processing')),state text NOT NULL DEFAULT 'new' CHECK(state IN('new','seen','acknowledged')),
 state_revision integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),seen_at timestamptz,acknowledged_at timestamptz,
 UNIQUE(analysis_id,care_link_id,kind)
);
CREATE TABLE public.journal_audit_events(
 id uuid PRIMARY KEY,patient_id uuid NOT NULL,actor_id uuid,action text NOT NULL,entry_id text,revision integer,created_at timestamptz NOT NULL DEFAULT now()
);
-- Preserve existing encrypted originals without decrypting or scheduling history.
INSERT INTO public.journal_notes(patient_id,entry_id,current_revision,updated_at) SELECT patient_id,id,1,saved_at FROM public.patient_entries WHERE type='journal';
INSERT INTO public.journal_note_revisions(patient_id,entry_id,revision,payload,cipher_context,observation_day,saved_at)
 SELECT patient_id,id,1,payload,patient_id::text||':'||id,observation_day,saved_at FROM public.patient_entries WHERE type='journal';
-- Resolve the circular deferred foreign key before indexing backfilled rows.
-- A populated legacy database otherwise has pending trigger events here.
SET CONSTRAINTS ALL IMMEDIATE;
CREATE INDEX journal_notes_page ON public.journal_notes(patient_id,updated_at DESC,entry_id DESC);
CREATE INDEX journal_jobs_ready ON public.journal_analysis_jobs(available_at,id) WHERE state IN('queued','retry_wait');
CREATE INDEX journal_jobs_leases ON public.journal_analysis_jobs(lease_until) WHERE state='running';
CREATE INDEX journal_alerts_inbox ON public.doctor_note_alerts(doctor_id,created_at DESC,id DESC);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['journal_notes','journal_note_revisions','journal_mutation_receipts','journal_access_guard','journal_analysis_jobs','journal_note_analyses','journal_audit_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY journal_owner ON public.%I TO compass_app USING(patient_id=nullif(current_setting(''app.patient_id'',true),'''')::uuid) WITH CHECK(patient_id=nullif(current_setting(''app.patient_id'',true),'''')::uuid)',t);
  EXECUTE format('CREATE POLICY journal_service ON public.%I TO compass_journal_service USING(true) WITH CHECK(true)',t);
 END LOOP;
END $$;
ALTER TABLE public.doctor_note_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_note_alerts FORCE ROW LEVEL SECURITY;
CREATE POLICY journal_service ON public.doctor_note_alerts TO compass_journal_service USING(true) WITH CHECK(true);
CREATE POLICY journal_doctor_alert ON public.doctor_note_alerts TO compass_app USING(
 doctor_id=nullif(current_setting('app.actor_id',true),'')::uuid AND EXISTS(
 SELECT 1 FROM public.care_links l WHERE l.id=doctor_note_alerts.care_link_id AND l.status='active' AND l.doctor_id=doctor_note_alerts.doctor_id)
) WITH CHECK(doctor_id=nullif(current_setting('app.actor_id',true),'')::uuid);
CREATE POLICY journal_service_links ON public.care_links TO compass_journal_service USING(true);
CREATE POLICY journal_guard_doctor ON public.journal_access_guard FOR SELECT TO compass_app USING(EXISTS(
 SELECT 1 FROM public.care_links l WHERE l.patient_id=journal_access_guard.patient_id AND l.doctor_id=nullif(current_setting('app.actor_id',true),'')::uuid AND l.status='active'
));
CREATE POLICY journal_alert_sharing ON public.doctor_note_alerts AS RESTRICTIVE TO compass_app USING(EXISTS(
 SELECT 1 FROM public.journal_access_guard g WHERE g.patient_id=doctor_note_alerts.patient_id AND g.health_data AND g.processing AND g.sharing
));
GRANT USAGE ON SCHEMA public TO compass_journal_service,compass_journal_worker;
GRANT SELECT,INSERT,UPDATE ON public.journal_notes,public.journal_access_guard,public.journal_analysis_jobs TO compass_app;
GRANT SELECT,INSERT ON public.journal_note_revisions,public.journal_mutation_receipts,public.journal_audit_events TO compass_app;
GRANT SELECT ON public.journal_note_analyses TO compass_app;
GRANT SELECT,UPDATE ON public.doctor_note_alerts TO compass_app;
GRANT SELECT,INSERT,UPDATE ON public.journal_analysis_jobs,public.journal_access_guard TO compass_journal_service;
GRANT SELECT ON public.journal_notes,public.journal_note_revisions TO compass_journal_service;
GRANT SELECT,INSERT ON public.journal_note_analyses,public.doctor_note_alerts,public.journal_audit_events TO compass_journal_service;
GRANT SELECT,UPDATE(id) ON public.local_patients,public.care_links TO compass_journal_service;

CREATE FUNCTION public.journal_claim(p_token uuid) RETURNS SETOF public.journal_analysis_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE public.journal_analysis_jobs SET state='failed',error_code='ATTEMPTS_EXHAUSTED',lease_token=NULL,lease_until=NULL
 WHERE state='running' AND lease_until<now() AND attempts>=4;
 RETURN QUERY WITH candidate AS (
  SELECT id FROM public.journal_analysis_jobs WHERE attempts<4 AND
   ((state IN('queued','retry_wait') AND available_at<=now()) OR (state='running' AND lease_until<now()))
  ORDER BY available_at,id LIMIT 1 FOR UPDATE SKIP LOCKED
 ) UPDATE public.journal_analysis_jobs j SET state='running',attempts=attempts+1,lease_token=p_token,lease_until=now()+interval '120 seconds'
 FROM candidate c WHERE j.id=c.id RETURNING j.*;
END $$;

CREATE FUNCTION public.journal_load(p_id uuid,p_token uuid) RETURNS TABLE(payload bytea,cipher_context text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.journal_analysis_jobs;g public.journal_access_guard;
BEGIN
 SELECT * INTO j FROM public.journal_analysis_jobs WHERE id=p_id;
 IF NOT FOUND THEN RETURN; END IF;
 PERFORM id FROM public.local_patients WHERE id=j.patient_id FOR UPDATE;
 SELECT * INTO g FROM public.journal_access_guard WHERE patient_id=j.patient_id FOR UPDATE;
 SELECT * INTO j FROM public.journal_analysis_jobs WHERE id=p_id FOR UPDATE;
 IF j.state<>'running' OR j.lease_token IS DISTINCT FROM p_token OR j.lease_until<=now() THEN RETURN; END IF;
 IF g.patient_id IS NULL OR NOT(g.health_data AND g.processing AND g.ai_enabled) OR g.authorization_epoch<>j.authorization_epoch THEN
  UPDATE public.journal_analysis_jobs SET state='cancelled',lease_token=NULL,lease_until=NULL WHERE id=p_id;RETURN;
 END IF;
 RETURN QUERY SELECT r.payload,r.cipher_context FROM public.journal_note_revisions r WHERE r.patient_id=j.patient_id AND r.entry_id=j.entry_id AND r.revision=j.revision;
END $$;

CREATE FUNCTION public.journal_complete(p_id uuid,p_token uuid,p_payload bytea,p_level text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.journal_analysis_jobs;g public.journal_access_guard;l record;
BEGIN
 IF p_level NOT IN('routine','elevated','urgent','indeterminate') OR octet_length(p_payload)>50000 THEN RAISE EXCEPTION 'Invalid result';END IF;
 SELECT * INTO j FROM public.journal_analysis_jobs WHERE id=p_id;IF NOT FOUND THEN RETURN false;END IF;
 PERFORM id FROM public.local_patients WHERE id=j.patient_id FOR UPDATE;
 SELECT * INTO g FROM public.journal_access_guard WHERE patient_id=j.patient_id FOR UPDATE;
 PERFORM id FROM public.care_links WHERE patient_id=j.patient_id ORDER BY id FOR SHARE;
 SELECT * INTO j FROM public.journal_analysis_jobs WHERE id=p_id FOR UPDATE;
 IF j.state<>'running' OR j.lease_token IS DISTINCT FROM p_token OR j.lease_until<=now() THEN RETURN false;END IF;
 IF g.patient_id IS NULL OR NOT(g.health_data AND g.processing AND g.ai_enabled) OR g.authorization_epoch<>j.authorization_epoch THEN
  UPDATE public.journal_analysis_jobs SET state='cancelled',lease_token=NULL,lease_until=NULL WHERE id=p_id;RETURN false;
 END IF;
 INSERT INTO public.journal_note_analyses(job_id,patient_id,entry_id,revision,payload,signal_level) VALUES(j.id,j.patient_id,j.entry_id,j.revision,p_payload,p_level);
 IF g.sharing AND p_level<>'routine' THEN
  FOR l IN SELECT * FROM public.care_links WHERE patient_id=j.patient_id AND status='active' LOOP
   INSERT INTO public.doctor_note_alerts(id,analysis_id,patient_id,care_link_id,doctor_id,kind)
   VALUES(gen_random_uuid(),j.id,j.patient_id,l.id,l.doctor_id,CASE WHEN p_level='indeterminate' THEN 'processing' ELSE 'signal' END);
  END LOOP;
 END IF;
 UPDATE public.journal_analysis_jobs SET state='succeeded',lease_token=NULL,lease_until=NULL,completed_at=now(),error_code=NULL WHERE id=p_id;
 RETURN true;
END $$;
CREATE FUNCTION public.journal_fail(p_id uuid,p_token uuid,p_code text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 UPDATE public.journal_analysis_jobs SET state=CASE WHEN attempts>=4 THEN 'failed' ELSE 'retry_wait' END,
 error_code=CASE WHEN p_code IN('INVALID_ANALYSIS','STUB_ERROR') THEN p_code ELSE 'PROCESSING_ERROR' END,
 available_at=now()+CASE attempts WHEN 1 THEN interval '15 seconds' WHEN 2 THEN interval '1 minute' ELSE interval '5 minutes' END,
 lease_token=NULL,lease_until=NULL WHERE id=p_id AND state='running' AND lease_token=p_token AND lease_until>now();
$$;
ALTER FUNCTION public.journal_claim(uuid) OWNER TO compass_journal_service;
ALTER FUNCTION public.journal_load(uuid,uuid) OWNER TO compass_journal_service;
ALTER FUNCTION public.journal_complete(uuid,uuid,bytea,text) OWNER TO compass_journal_service;
ALTER FUNCTION public.journal_fail(uuid,uuid,text) OWNER TO compass_journal_service;
REVOKE ALL ON FUNCTION public.journal_claim(uuid),public.journal_load(uuid,uuid),public.journal_complete(uuid,uuid,bytea,text),public.journal_fail(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.journal_claim(uuid),public.journal_load(uuid,uuid),public.journal_complete(uuid,uuid,bytea,text),public.journal_fail(uuid,uuid,text) TO compass_journal_worker;
INSERT INTO public.schema_migrations(id) VALUES('017-journal');
COMMIT;
\endif
-- Password is supplied by the migration runner via environment, not process arguments.
\if :{?journal_worker_password}
\else
\getenv journal_worker_password COMPASS_JOURNAL_PASSWORD
\endif
\if :{?journal_worker_password}
ALTER ROLE compass_journal_worker PASSWORD :'journal_worker_password';
\endif
