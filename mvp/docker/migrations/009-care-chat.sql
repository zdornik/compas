SELECT NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE id='009-care-chat') AS apply_care_chat_migration \gset
\if :apply_care_chat_migration
BEGIN;
SELECT pg_advisory_xact_lock(2026101909);
CREATE TABLE care_messages(
 link_id uuid NOT NULL REFERENCES care_links(id),
 id uuid NOT NULL,
 sender_id uuid NOT NULL REFERENCES local_patients(id),
 payload bytea NOT NULL,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 PRIMARY KEY(link_id,id)
);
CREATE INDEX care_messages_chronological ON care_messages(link_id,created_at DESC,id DESC);
ALTER TABLE care_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY care_message_read ON care_messages FOR SELECT TO compass_app USING(EXISTS(
 SELECT 1 FROM care_links l WHERE l.id=care_messages.link_id AND l.status='active'
 AND nullif(current_setting('app.actor_id',true),'')::uuid IN(l.patient_id,l.doctor_id)
));
CREATE POLICY care_message_send ON care_messages FOR INSERT TO compass_app WITH CHECK(
 sender_id=nullif(current_setting('app.actor_id',true),'')::uuid AND EXISTS(
 SELECT 1 FROM care_links l WHERE l.id=care_messages.link_id AND l.status='active'
 AND care_messages.sender_id IN(l.patient_id,l.doctor_id)
 ));
GRANT SELECT,INSERT ON care_messages TO compass_app;
INSERT INTO schema_migrations(id) VALUES('009-care-chat');
COMMIT;
\endif
