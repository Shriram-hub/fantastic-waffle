CREATE TABLE IF NOT EXISTS orbit_runtime.discovered_boards(id TEXT PRIMARY KEY,source TEXT NOT NULL,slug TEXT NOT NULL,status TEXT NOT NULL,body TEXT NOT NULL,checked_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS orbit_runtime.outreach_company_budget(domain TEXT NOT NULL,email TEXT NOT NULL,task_id TEXT NOT NULL,status TEXT NOT NULL,updated_at BIGINT NOT NULL,PRIMARY KEY(domain,email));
CREATE INDEX IF NOT EXISTS outreach_company_window ON orbit_runtime.outreach_company_budget(domain,updated_at);
