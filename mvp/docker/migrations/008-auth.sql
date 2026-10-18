SELECT NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE id='008-auth') AS apply_auth \gset
\if :apply_auth
BEGIN;
SELECT pg_advisory_xact_lock(2026101908);
CREATE TABLE auth_accounts (
 id uuid PRIMARY KEY, principal_id uuid NOT NULL UNIQUE REFERENCES local_patients(id),
 login_hash text NOT NULL CHECK(length(login_hash)=64),
 role text NOT NULL CHECK(role IN ('patient','doctor')),
 password_hash text NOT NULL, payload bytea NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(login_hash,role)
);
CREATE TABLE auth_consent_events (
 id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES auth_accounts(id),
 principal_id uuid NOT NULL REFERENCES local_patients(id), payload bytea NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_sessions ADD COLUMN account_id uuid REFERENCES auth_accounts(id);
CREATE INDEX auth_sessions_account ON app_sessions(account_id) WHERE account_id IS NOT NULL;
ALTER TABLE auth_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY auth_access ON auth_accounts TO compass_app
 USING(principal_id=nullif(current_setting('app.actor_id',true),'')::uuid
    OR principal_id=nullif(current_setting('app.patient_id',true),'')::uuid
    OR login_hash=nullif(current_setting('app.login_hash',true),''))
 WITH CHECK(principal_id=nullif(current_setting('app.actor_id',true),'')::uuid);
ALTER TABLE auth_consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_consent_events FORCE ROW LEVEL SECURITY;
CREATE POLICY consent_owner ON auth_consent_events TO compass_app
 USING(principal_id=nullif(current_setting('app.actor_id',true),'')::uuid)
 WITH CHECK(principal_id=nullif(current_setting('app.actor_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON auth_accounts TO compass_app;
GRANT SELECT,INSERT ON auth_consent_events TO compass_app;
INSERT INTO public.schema_migrations(id) VALUES('008-auth');
COMMIT;
\endif
