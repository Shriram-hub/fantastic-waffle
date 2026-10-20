-- Apply once as the database administrator before deploying Google sign-in to
-- an existing Supabase workspace with DATABASE_AUTO_MIGRATE=false.
CREATE TABLE IF NOT EXISTS orbit_runtime.workspace_identity(id TEXT PRIMARY KEY CHECK(id='owner'),subject TEXT NOT NULL UNIQUE,email TEXT NOT NULL,name TEXT NOT NULL,created_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS orbit_runtime.auth_sessions(id TEXT PRIMARY KEY,body TEXT NOT NULL,expires BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS auth_session_expiry ON orbit_runtime.auth_sessions(expires);
CREATE TABLE IF NOT EXISTS orbit_runtime.auth_rate_limits(id TEXT PRIMARY KEY,attempts BIGINT NOT NULL,reset_at BIGINT NOT NULL);
REVOKE ALL ON orbit_runtime.workspace_identity,orbit_runtime.auth_sessions,orbit_runtime.auth_rate_limits FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON orbit_runtime.workspace_identity,orbit_runtime.auth_sessions,orbit_runtime.auth_rate_limits TO orbit_app;
ALTER TABLE orbit_runtime.workspace_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE orbit_runtime.auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE orbit_runtime.auth_rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY orbit_private_server ON orbit_runtime.workspace_identity FOR ALL TO orbit_app USING(true) WITH CHECK(true);
CREATE POLICY orbit_private_server ON orbit_runtime.auth_sessions FOR ALL TO orbit_app USING(true) WITH CHECK(true);
CREATE POLICY orbit_private_server ON orbit_runtime.auth_rate_limits FOR ALL TO orbit_app USING(true) WITH CHECK(true);
