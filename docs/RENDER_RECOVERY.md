# Render memory recovery

The October 22 outage was a Node heap exhaustion in the embedded worker after
discovery reached 15,000 indexed jobs. The worker supervisor restarted the whole
web service, causing repeated 502 responses. Even the sign-in page, JavaScript
assets and health endpoint previously loaded full database snapshots.

## Recovery changes

- Read the job index in 256-row pages within one repeatable-read transaction.
  Coalesce concurrent cache refreshes, and reuse unchanged immutable records.
- Keep one immutable optimistic baseline and one editable working copy. Reuse
  unchanged baseline records after saving, and release unused startup snapshots
  in the production API and worker.
- Share frozen job records for dashboard/feed/logo reads while isolating the
  remaining editable state. Bound full workspace requests to two at a time.
- Serve the public shell, assets, auth/session endpoints, health checks and SSE
  without creating full workspace snapshots. Database-dependent failures retain
  a safe reference in the response and sanitized diagnostic logs.
- Restart an interrupted worker with backoff without stopping the web process.
  Existing queue leases and outbound-send reconciliation rules remain in force.

No credentials, schema migration, paid plan, platform switch or reduced index
capacity is required. Render and Supabase remain the deployment platforms.

## Verification

Run `npm test`, `npm run build` and `npm run check`. Regression coverage includes
paged/coalesced reads, isolated edits and failed-read recovery, a sign-in shell
and live stream during snapshot failure, and recovery after killing the real
embedded worker while health requests continue to succeed.

After deployment, verify the root page, `/api/health`, `/api/auth/session`, a
signed workspace check and recent worker activity. Check Render logs for
`workspace-storage-failed`, `embedded-worker-restarting` and heap exhaustion.
A successful Render deploy alone is not sufficient verification.
