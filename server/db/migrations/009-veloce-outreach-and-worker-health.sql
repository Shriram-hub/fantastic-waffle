-- Additive migration. Apply as the Supabase administrator before deploying Veloce UI.
-- The workspace is private; no end-user JWT receives direct access to these tables.
CREATE TABLE IF NOT EXISTS orbit_runtime.outreach_job_reservations (
  workspace_id TEXT NOT NULL,
  contact_email TEXT NOT NULL CHECK(contact_email=lower(trim(contact_email))),
  job_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY(workspace_id,contact_email,job_id)
);
CREATE TABLE IF NOT EXISTS orbit_runtime.worker_health (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  heartbeat_at BIGINT NOT NULL
);
REVOKE ALL ON orbit_runtime.outreach_job_reservations,orbit_runtime.worker_health FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON orbit_runtime.outreach_job_reservations,orbit_runtime.worker_health TO orbit_app;
ALTER TABLE orbit_runtime.outreach_job_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE orbit_runtime.worker_health ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orbit_private_server ON orbit_runtime.outreach_job_reservations;
CREATE POLICY orbit_private_server ON orbit_runtime.outreach_job_reservations FOR ALL TO orbit_app USING(true) WITH CHECK(true);
DROP POLICY IF EXISTS orbit_private_server ON orbit_runtime.worker_health;
CREATE POLICY orbit_private_server ON orbit_runtime.worker_health FOR ALL TO orbit_app USING(true) WITH CHECK(true);
