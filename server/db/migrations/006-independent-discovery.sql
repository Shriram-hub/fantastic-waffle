
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
