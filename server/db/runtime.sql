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
