-- Optional Supabase Free scheduler for the private Render deployment.
-- Apply 004-autopilot.sql first. Create a Vault secret named
-- orbit_scheduler_secret, matching Render's AUTOPILOT_CRON_SECRET.
-- This dispatches real due tasks; it does not send empty keep-alive requests.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION orbit_runtime.dispatch_due_work()
RETURNS bigint
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  clock_ms bigint := (extract(epoch FROM now()) * 1000)::bigint;
  credential text;
  request_id bigint;
BEGIN
  IF NOT (
    EXISTS (SELECT 1 FROM orbit_runtime.tasks WHERE
      (status = 'queued' AND run_at <= clock_ms) OR
      (status = 'running' AND lease_until < clock_ms))
    OR EXISTS (
      SELECT 1 FROM orbit_runtime.job_search_config c
      WHERE c.id='local' AND (c.body::jsonb->>'enabled')='true'
        AND NOT EXISTS (SELECT 1 FROM orbit_runtime.autopilot_schedule s WHERE s.id='jobs' AND s.next_run>clock_ms)
    )
    OR EXISTS (
      SELECT 1 FROM orbit_runtime.mail_accounts a
      WHERE NOT EXISTS (SELECT 1 FROM orbit_runtime.autopilot_schedule s WHERE s.id='mailbox:' || a.id AND s.next_run>clock_ms)
    )
    OR EXISTS (
      SELECT 1 FROM orbit_runtime.autopilot_config c
      WHERE c.id = 'local' AND (c.body::jsonb->>'enabled') = 'true'
        AND NOT EXISTS (SELECT 1 FROM orbit_runtime.autopilot_schedule s WHERE s.id='local' AND s.next_run > clock_ms)
    )
  ) THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO credential FROM vault.decrypted_secrets WHERE name='orbit_scheduler_secret';
  IF credential IS NULL THEN RETURN NULL; END IF;
  SELECT net.http_post(
    url := 'https://orbit-a1jt.onrender.com/api/internal/autopilot/tick',
    headers := jsonb_build_object('Content-Type','application/json','X-Orbit-Scheduler',credential),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) INTO request_id;
  RETURN request_id;
END;
$function$;
REVOKE ALL ON FUNCTION orbit_runtime.dispatch_due_work() FROM PUBLIC,anon,authenticated,orbit_app;

-- The two-minute dispatch cadence is only used when a task is actually due.
-- Discovery itself is reserved once per two hours in autopilot_schedule.
SELECT cron.schedule('orbit-dispatch-due-work','*/2 * * * *',
  $$SELECT orbit_runtime.dispatch_due_work();$$);
SELECT cron.schedule('orbit-prune-scheduler-history','17 3 * * *',
  $$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'
      AND jobid IN (SELECT jobid FROM cron.job WHERE jobname IN ('orbit-dispatch-due-work','orbit-prune-scheduler-history'));$$);
