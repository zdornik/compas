SELECT NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE id='018-appointments') AS apply_appointments \gset
\if :apply_appointments
BEGIN;
SELECT pg_advisory_xact_lock(2026102018);
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE public.care_appointments(
 id uuid PRIMARY KEY, link_id uuid NOT NULL REFERENCES public.care_links(id),
 patient_id uuid NOT NULL REFERENCES public.local_patients(id),doctor_id uuid NOT NULL REFERENCES public.local_patients(id),
 starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,
 status text NOT NULL CHECK(status IN ('requested','confirmed','declined','cancelled')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),created_by uuid NOT NULL REFERENCES public.local_patients(id),
 request_hash text NOT NULL CHECK(length(request_hash)=64),payload bytea NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_at>starts_at AND ends_at-starts_at BETWEEN interval '15 minutes' AND interval '180 minutes'),
 CHECK(created_by IN(patient_id,doctor_id) AND patient_id<>doctor_id),
 EXCLUDE USING gist(doctor_id WITH =,tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE(status='confirmed'),
 EXCLUDE USING gist(patient_id WITH =,tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE(status='confirmed')
);
CREATE INDEX appointment_patient_time ON public.care_appointments(patient_id,starts_at,id);
CREATE INDEX appointment_doctor_time ON public.care_appointments(doctor_id,starts_at,id);
CREATE INDEX appointment_link ON public.care_appointments(link_id);
CREATE TABLE public.care_appointment_events(
 id uuid PRIMARY KEY,appointment_id uuid NOT NULL REFERENCES public.care_appointments(id),
 revision integer NOT NULL,actor_id uuid NOT NULL REFERENCES public.local_patients(id),
 mutation_id uuid,request_hash text,payload bytea NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(appointment_id,revision),UNIQUE(appointment_id,mutation_id)
);
ALTER TABLE public.care_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.care_appointments FORCE ROW LEVEL SECURITY;
CREATE POLICY appointment_access ON public.care_appointments TO compass_app
 USING(patient_id=nullif(current_setting('app.actor_id',true),'')::uuid OR
 (doctor_id=nullif(current_setting('app.actor_id',true),'')::uuid AND EXISTS(
  SELECT 1 FROM public.care_links l WHERE l.id=link_id AND l.patient_id=care_appointments.patient_id AND l.doctor_id=care_appointments.doctor_id AND l.status='active') AND EXISTS(
  SELECT 1 FROM public.journal_access_guard g WHERE g.patient_id=care_appointments.patient_id AND g.health_data)))
 WITH CHECK(nullif(current_setting('app.actor_id',true),'')::uuid IN(patient_id,doctor_id) AND EXISTS(
  SELECT 1 FROM public.care_links l WHERE l.id=link_id AND l.patient_id=care_appointments.patient_id AND l.doctor_id=care_appointments.doctor_id AND l.status='active'));
ALTER TABLE public.care_appointment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.care_appointment_events FORCE ROW LEVEL SECURITY;
CREATE POLICY appointment_event_access ON public.care_appointment_events TO compass_app
 USING(EXISTS(SELECT 1 FROM public.care_appointments a WHERE a.id=appointment_id))
 WITH CHECK(actor_id=nullif(current_setting('app.actor_id',true),'')::uuid AND EXISTS(SELECT 1 FROM public.care_appointments a WHERE a.id=appointment_id));
GRANT SELECT,INSERT ON public.care_appointments,public.care_appointment_events TO compass_app;
GRANT UPDATE(status,revision,updated_at) ON public.care_appointments TO compass_app;
INSERT INTO public.schema_migrations(id) VALUES('018-appointments');
COMMIT;
\endif
