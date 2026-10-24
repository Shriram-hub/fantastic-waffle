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
