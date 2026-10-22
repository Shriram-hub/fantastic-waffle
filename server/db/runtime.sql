-- Runtime tables for a single private Orbit workspace. Never expose this schema via a public data API.
CREATE SCHEMA IF NOT EXISTS orbit_runtime;

CREATE TABLE IF NOT EXISTS orbit_runtime.migrations(row_order BIGSERIAL UNIQUE,version BIGINT PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orbit_runtime.workspace_meta(row_order BIGSERIAL UNIQUE,id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orbit_runtime.user_profiles(row_order BIGSERIAL UNIQUE,id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orbit_runtime.resumes(row_order BIGSERIAL UNIQUE,id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orbit_runtime.job_listings(row_order BIGSERIAL UNIQUE,id TEXT PRIMARY KEY, company TEXT, title TEXT, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orbit_runtime.applications(row_order BIGSERIAL UNIQUE,id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES orbit_runtime.job_listings(id), stage TEXT NOT NULL, body TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS application_stage ON orbit_runtime.applications(stage);
CREATE UNIQUE INDEX IF NOT EXISTS application_job ON orbit_runtime.applications(job_id);
CREATE TABLE IF NOT EXISTS orbit_runtime.contacts(row_order BIGSERIAL UNIQUE,id TEXT PRIMARY KEY, email TEXT, suppressed BIGINT DEFAULT 0, body TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS contact_email ON orbit_runtime.contacts(email) WHERE email IS NOT NULL AND email != '';
CREATE TABLE IF NOT EXISTS orbit_runtime.campaigns(row_order BIGSERIAL UNIQUE,id TEXT PRIMARY KEY, status TEXT, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orbit_runtime.inbox_updates(row_order BIGSERIAL UNIQUE,id TEXT PRIMARY KEY, application_id TEXT REFERENCES orbit_runtime.applications(id), body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orbit_runtime.tasks(row_order BIGSERIAL UNIQUE,id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', run_at BIGINT NOT NULL, attempts BIGINT DEFAULT 0, max_attempts BIGINT DEFAULT 3, lease_until BIGINT, lease_token TEXT, dedupe_key TEXT UNIQUE, result TEXT, error TEXT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS task_due ON orbit_runtime.tasks(status,run_at);
CREATE TABLE IF NOT EXISTS orbit_runtime.task_logs(row_order BIGSERIAL UNIQUE,id BIGSERIAL PRIMARY KEY, task_id TEXT NOT NULL REFERENCES orbit_runtime.tasks(id) ON DELETE CASCADE, at BIGINT NOT NULL, message TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orbit_runtime.mail_accounts(row_order BIGSERIAL UNIQUE,id TEXT PRIMARY KEY, provider TEXT NOT NULL, email TEXT NOT NULL, secret TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS orbit_runtime.oauth_states(row_order BIGSERIAL UNIQUE,id TEXT PRIMARY KEY, secret TEXT NOT NULL, expires BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS orbit_runtime.workspace_identity(id TEXT PRIMARY KEY CHECK(id='owner'),subject TEXT NOT NULL UNIQUE,email TEXT NOT NULL,name TEXT NOT NULL,created_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS orbit_runtime.auth_sessions(id TEXT PRIMARY KEY,body TEXT NOT NULL,expires BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS auth_session_expiry ON orbit_runtime.auth_sessions(expires);
CREATE TABLE IF NOT EXISTS orbit_runtime.auth_rate_limits(id TEXT PRIMARY KEY,attempts BIGINT NOT NULL,reset_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS orbit_runtime.inbox_messages(row_order BIGSERIAL UNIQUE,id TEXT PRIMARY KEY, provider TEXT NOT NULL, account_id TEXT NOT NULL, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orbit_runtime.resume_versions(row_order BIGSERIAL UNIQUE,id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL, created_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS orbit_runtime.embeddings(row_order BIGSERIAL UNIQUE,id TEXT PRIMARY KEY, model TEXT NOT NULL, content_hash TEXT NOT NULL, vector TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orbit_runtime.apply_tasks(row_order BIGSERIAL UNIQUE,id TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES orbit_runtime.applications(id), status TEXT NOT NULL, token_hash TEXT, lease_until BIGINT, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orbit_runtime.extension_tokens(row_order BIGSERIAL UNIQUE,id TEXT PRIMARY KEY, expires BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS orbit_runtime.send_leases(row_order BIGSERIAL UNIQUE,account_id TEXT PRIMARY KEY, not_before BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS orbit_runtime.send_budget(row_order BIGSERIAL UNIQUE,account_id TEXT NOT NULL,day TEXT NOT NULL,count BIGINT NOT NULL,PRIMARY KEY(account_id,day));

CREATE TABLE IF NOT EXISTS orbit_runtime.outreach_send_log(row_order BIGSERIAL UNIQUE,user_id TEXT NOT NULL DEFAULT 'local',contact_email TEXT NOT NULL,campaign_id TEXT NOT NULL,sequence_step BIGINT NOT NULL DEFAULT 0,task_id TEXT NOT NULL,status TEXT NOT NULL,provider_id TEXT,updated_at BIGINT NOT NULL,PRIMARY KEY(user_id,contact_email,campaign_id,sequence_step));
CREATE TABLE IF NOT EXISTS orbit_runtime.unsubscribe_tokens(row_order BIGSERIAL UNIQUE,id TEXT PRIMARY KEY,email TEXT NOT NULL,created_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS orbit_runtime.ai_cache(row_order BIGSERIAL UNIQUE,id TEXT PRIMARY KEY,body TEXT NOT NULL,created_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS orbit_runtime.public_resumes(row_order BIGSERIAL UNIQUE,id TEXT PRIMARY KEY, resume_hash TEXT NOT NULL, expires BIGINT NOT NULL, revoked BIGINT DEFAULT 0, views BIGINT DEFAULT 0);

CREATE TABLE IF NOT EXISTS orbit_runtime.resume_objects(content_hash TEXT PRIMARY KEY,bytes BYTEA NOT NULL);

-- v0.4: opt-in autonomous discovery and durable provider request reservations.
CREATE TABLE IF NOT EXISTS orbit_runtime.companies(domain TEXT PRIMARY KEY,name TEXT NOT NULL,body TEXT NOT NULL);
ALTER TABLE orbit_runtime.contacts ADD COLUMN IF NOT EXISTS job_id TEXT REFERENCES orbit_runtime.job_listings(id) ON DELETE SET NULL;
ALTER TABLE orbit_runtime.contacts ADD COLUMN IF NOT EXISTS company_domain TEXT REFERENCES orbit_runtime.companies(domain);
CREATE INDEX IF NOT EXISTS contact_job ON orbit_runtime.contacts(job_id);
CREATE INDEX IF NOT EXISTS contact_domain ON orbit_runtime.contacts(company_domain);
CREATE TABLE IF NOT EXISTS orbit_runtime.search_matrices(id TEXT PRIMARY KEY,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orbit_runtime.autopilot_config(id TEXT PRIMARY KEY,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orbit_runtime.autopilot_schedule(id TEXT PRIMARY KEY,next_run BIGINT NOT NULL,cursor BIGINT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS orbit_runtime.autopilot_runs(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES orbit_runtime.job_listings(id) ON DELETE CASCADE,policy_id TEXT NOT NULL,status TEXT NOT NULL,body TEXT NOT NULL,updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS autopilot_run_status ON orbit_runtime.autopilot_runs(status,updated_at);
CREATE TABLE IF NOT EXISTS orbit_runtime.autopilot_activity(id TEXT PRIMARY KEY,at BIGINT NOT NULL,kind TEXT NOT NULL,message TEXT NOT NULL,count BIGINT);
CREATE INDEX IF NOT EXISTS autopilot_activity_time ON orbit_runtime.autopilot_activity(at);
CREATE TABLE IF NOT EXISTS orbit_runtime.provider_requests(id TEXT PRIMARY KEY,provider TEXT NOT NULL,day TEXT NOT NULL,status TEXT NOT NULL,body TEXT,created_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS provider_request_budget ON orbit_runtime.provider_requests(day,provider);

-- v0.5: discovery runs independently of contact lookup and email permissions.
CREATE TABLE IF NOT EXISTS orbit_runtime.job_search_config(id TEXT PRIMARY KEY,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orbit_runtime.job_search_runs(id TEXT PRIMARY KEY,status TEXT NOT NULL,body TEXT NOT NULL,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS orbit_runtime.job_source_health(id TEXT PRIMARY KEY,source TEXT NOT NULL,board TEXT NOT NULL,checked_at BIGINT NOT NULL,status TEXT NOT NULL,scanned BIGINT NOT NULL,matched BIGINT NOT NULL,message TEXT);
CREATE TABLE IF NOT EXISTS orbit_runtime.job_source_cache(id TEXT PRIMARY KEY,expires_at BIGINT NOT NULL,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orbit_runtime.workspace_revision(id TEXT PRIMARY KEY,value BIGINT NOT NULL DEFAULT 0);
INSERT INTO orbit_runtime.workspace_revision(id,value) VALUES('local',0) ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION orbit_runtime.bump_workspace_revision() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN UPDATE orbit_runtime.workspace_revision SET value=value+1 WHERE id='local'; RETURN NULL; END; $$;
DO $migration$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['workspace_meta','user_profiles','resumes','job_listings','applications','contacts','campaigns','inbox_updates'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS orbit_workspace_changed ON orbit_runtime.%I',tab);
    EXECUTE format('CREATE TRIGGER orbit_workspace_changed AFTER INSERT OR UPDATE OR DELETE ON orbit_runtime.%I FOR EACH STATEMENT EXECUTE FUNCTION orbit_runtime.bump_workspace_revision()',tab);
  END LOOP;
END $migration$;

CREATE TABLE IF NOT EXISTS orbit_runtime.discovered_boards(id TEXT PRIMARY KEY,source TEXT NOT NULL,slug TEXT NOT NULL,status TEXT NOT NULL,body TEXT NOT NULL,checked_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS orbit_runtime.outreach_company_budget(domain TEXT NOT NULL,email TEXT NOT NULL,task_id TEXT NOT NULL,status TEXT NOT NULL,updated_at BIGINT NOT NULL,PRIMARY KEY(domain,email));
CREATE INDEX IF NOT EXISTS outreach_company_window ON orbit_runtime.outreach_company_budget(domain,updated_at);

-- Veloce AI: one first-touch reservation per workspace / normalized email / role.
CREATE TABLE IF NOT EXISTS orbit_runtime.outreach_job_reservations(workspace_id TEXT NOT NULL,contact_email TEXT NOT NULL CHECK(contact_email=lower(trim(contact_email))),job_id TEXT NOT NULL,campaign_id TEXT NOT NULL,task_id TEXT NOT NULL,created_at BIGINT NOT NULL,PRIMARY KEY(workspace_id,contact_email,job_id));
CREATE TABLE IF NOT EXISTS orbit_runtime.worker_health(id TEXT PRIMARY KEY,status TEXT NOT NULL,heartbeat_at BIGINT NOT NULL);
