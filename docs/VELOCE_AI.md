# Veloce AI

Autonomous Career & Cold Outreach OS. This release keeps the existing private Render + Supabase workspace and credentials.

## Workspace experience

- Obsidian dark and Alabaster light themes, persisted before first paint. Fonts are served from the app; no external font CDN is needed.
- Four navigation groups, a collapsible sidebar, mailbox/AI configuration pills and worker status based on an actual persisted heartbeat. A heartbeat older than 45 seconds shows Offline.
- `Cmd+K` / `Ctrl+K` searches jobs, people and applications. Commands run discovery, process due work, change theme, open the vault, export contacts and check inbox connectivity. The mailbox check sends no email.
- Overview shows actual pipeline totals, three high-match unpitched jobs, draft approvals, inbox activity and quick actions. Totals are not represented as cohort conversion rates.
- Company logos use bounded, cached provider-hosted raster images when available, with monogram fallbacks. The browser loads them from the authenticated app origin.
- Applications support Kanban drag-and-drop, keyboard-accessible stage menus and a compact table. Ready appears in Saved; Interview scheduled appears in Interviewing; Rejected and Withdrawn appear in Archived while retaining their detailed stage. Moves create a manual history entry. Outreach Sent remains eligible for human-reviewed browser autofill and does not count as an employer application.
- Change workspace name and accent in Connections & Alerts → Workspace appearance. Theme and collapsed navigation are device preferences; brand settings persist in Postgres.

## Outreach and documents

Auto-pitch returns an asynchronous task immediately, without waiting for contact providers or PDFs. Repeated simultaneous preparation requests reuse the same task for the same profile, role and options. Free people search, company pages and MX checks run concurrently with four-second provider deadlines; timeouts retain reviewable results without treating MX as recipient verification. Optional paid requests still depend on provider credits and availability.

A unique Postgres/SQLite reservation for `(workspace_id, lower(trim(email)), job_id)` prevents initial messages for the same role from being queued in multiple campaigns. The send worker checks ownership again, including older outbox records. Existing queued, accepted or uncertain work is returned, not duplicated. A confirmed pre-send cancellation may be explicitly reviewed again; uncertain acceptance stays held. Approved follow-ups retain their own sequence-step identities and existing reply-stop, pacing and unsubscribe controls.

Each auto-pitch contact has a factual LinkedIn connection note below 200 UTF-16 characters and a follow-up DM below 450. Copy/open actions leave connection requests and message submission to the user.

Tailored Documents provides editable résumé sections and a cover letter beside a semantic, single-column A4 layout preview. The keyword meter compares exact listing terms with résumé text; it is not an employer ATS score. Editing creates a new private PDF version after factual review. Existing campaign attachments retain their approved document ID and bytes. The browser preview is a layout aid; PDF exports paginate to A4.

The Veloce AI Chrome extension is version 0.9.0. Its floating copilot uses an open Shadow DOM with a self-contained dark stylesheet. Download the new ZIP from Connections, load `veloce-ai-extension`, then pair it to the workspace. Existing tokens and protocol identifiers remain compatible. The extension fills supported fields and files and leaves final submission to the user.

## Deployment

No additional API keys are required. Keep the existing Gemini, Google OAuth, Hunter, SerpApi, database and encryption configuration.

For an existing Supabase installation with automatic migrations disabled, apply `server/db/migrations/009-veloce-outreach-and-worker-health.sql` as administrator before deploying. It adds the role/email reservation and heartbeat tables, enables RLS and grants only the restricted server role access. It neither replaces existing records nor changes sending permissions. New local stores and Postgres auto-migrations include both tables.

SSE sends `: heartbeat` every 20 seconds with `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`. The frontend closes failed connections, reconnects with exponential backoff up to 30 seconds and stops after authentication expires.

## Verification

Run `npm test`, `npm run check` and `npm run build`. Coverage includes Postgres and SQLite role/email reservations, simultaneous preparation requests, provider deadlines/concurrency, SSE heartbeat/reconnection, stage transitions, palette actions, strict LinkedIn lengths, immutable PDF edits and existing outreach/extension safeguards.

Desktop and 390px mobile Chromium checks cover all workspace views, both themes, keyboard search, drag-and-drop, document editing/downloads and modal scrolling. No deployment check sends outreach, connection requests or phone alerts. Real job-board form support still depends on the portal.
