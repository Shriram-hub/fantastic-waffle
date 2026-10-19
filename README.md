# Orbit v0.3 · Career workspace

A working personal workspace for job discovery, résumé preparation, application tracking, browser-assisted filling, inbox updates, company contacts, and reviewed outreach.

SQLite remains the local default. Set `DATABASE_URL` to use the real PostgreSQL runtime, including durable jobs, send logs, encrypted mailbox credentials, and private resume objects. `RUN_EMBEDDED_WORKER=true` supervises a worker alongside the API on a single hosting service. OAuth connects mailboxes; this is one private personal workspace.

## Free online hosting

Use Render Free + Supabase Free with no PC running: [complete hosting instructions](docs/FREE_HOSTING.md). The web service and worker sleep together on the free plan; queued work survives in PostgreSQL and resumes after wake. Provider API access is separate from hosting.

## Start locally

Requires **Node.js 24+**.

```bash
git clone -b codex/orbit-prototype https://github.com/Shriram-hub/fantastic-waffle.git
cd fantastic-waffle
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. The development command starts the React development server, API on port 3000, and a separate worker. Close it with Ctrl+C. The initial workspace is prominently labeled fictional sample data. Choose **Start my workspace** for your own information.

For a production build locally, use two terminals:

```bash
# Terminal 1: builds the frontend, then starts the API
npm start

# Terminal 2: processes queued work
npm run worker
```

Open **http://127.0.0.1:3000**. Without the worker, imports, parsing, matching, and sends remain visibly queued.

Copy `.env.example` to `.env` to configure optional services. No provider credentials are necessary for the sample workspace, manual tracking, TXT/DOCX parsing, printable résumé tailoring, or email draft downloads. PDF text extraction uses optional Poppler `pdftotext`; Docker includes it. Without Poppler, the PDF remains stored and attachable and you can paste its text.

## What is implemented

| Area              | Working implementation                                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface         | React components, Vite production build, Tailwind + retained Orbit styles, responsive views, explicit connection/queue status.                                                                                                                          |
| Persistence       | Relational SQLite tables, v1 migration, foreign keys and indexes, request-scoped snapshots, per-record conflict checks across API/worker processes.                                                                                                     |
| Workers           | Durable SQLite task outbox, atomic claims, expiring leases, logs, cancellation, backoff for retryable tasks, separate worker process. Optional Redis + BullMQ dispatch.                                                                                 |
| Job feeds         | Remotive, selected Greenhouse/Lever/Ashby boards, Arbeitnow, and optional Adzuna. Canonical company/title/location deduplication preserves application-linked IDs and source provenance.                                                                |
| Résumé vault      | Background TXT/DOCX/PDF extraction, reviewed skill suggestions, optional schema-validated model extraction, private local/S3/R2 files, printable fact-preserving versions.                                                                              |
| Matching          | Explained keyword scores plus optional real embedding/cosine matching. Scores retain model/content fingerprints and invalidate when source text changes.                                                                                                |
| Browser assistant | Chrome MV3 extension, expiring/revocable pairing tokens, destination checks, approved-field filling, résumé attachment, unknown-question reporting, verification-challenge stop, user-confirmed submission reference.                                   |
| Inbox             | Google/Microsoft OAuth with PKCE and encrypted tokens, Gmail history and Graph delta sync, push webhook handlers, watch renewals, rule-based classification and optional structured model classification.                                               |
| Tracker           | Board/list views, notes/history, assessment stage and extracted deadlines, reviewed or opt-in conservative automatic updates, CSV export.                                                                                                               |
| Contacts          | CSV/manual records, contextual Apollo targeting, separate paid enrichment, optional Hunter verification, catch-all/invalid blocking, suppression, evidence-checked AI opening lines for review.                                                         |
| Outreach          | Saved/edited drafts, per-recipient previews and `.eml` downloads, native Gmail/Outlook sends or Resend, durable scheduled sends, 30/day default cap (maximum 50), business-hour pacing, one approved threaded follow-up, reply/suppression/pause stops. |
| Résumé links      | Explicitly approved unlisted seven-day links, revocation, file-version binding, request counts labeled as requests rather than proof of human reading.                                                                                                  |

**Still separate milestones:** multi-user sign-in/isolation, PostgreSQL runtime cutover, broader licensed aggregator coverage such as JSearch/SerpApi, generic headless auto-submit workers, a rich-text multi-step sequence builder, bounce/delivery webhooks and automatic unsubscribe parsing, file-retention cleanup, and production deployment/operations review. There is no universal ATS application-submission claim.

## Five-minute workflow

1. Explore the fictional sample, then start a personal workspace. Save your real profile, target roles, skills, links, notice period, salary expectation, and exact approved screening answers.
2. Upload a résumé. Watch extraction in **Automation**, review its text/suggestions, and optionally request structured extraction. Nothing inferred by a model silently replaces your profile.
3. Save company board slugs in **Connections**. Refresh job sources in **Job feed**, choose jobs, and prepare multiple applications. Keyword matching works without a model key; semantic matching requires confirmation and an embedding model.
4. Choose **Browser-assisted fill**, pair the extension, and open one queued form. Review all fields, complete unknown questions or verification directly, and submit yourself. Record the employer’s confirmation in Orbit.
5. Connect a mailbox or paste email updates. Automatic stage changes are opt-in and require a unique role match. Assessment links and explicit dates appear in the dashboard.
6. Find/import relevant contacts, enrich/verify selected work emails, and optionally draft an evidence-backed opening line. Preview initial and follow-up messages, attachments, sender account, and recipients before queueing.

## Optional service configuration

See [provider setup](docs/SETUP.md) for exact callbacks, scopes, webhook authentication, and required infrastructure.

| Service                 | Environment values                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| API hosting             | `HOST`, `PORT`, `DATA_DIR`, `WORKSPACE_PASSWORD`, `PUBLIC_BASE_URL`, optional `ALLOWED_HOSTS`         |
| BullMQ dispatch         | `REDIS_URL`; API inserts into SQLite immediately, the worker publishes the outbox to Redis.           |
| Apollo                  | `APOLLO_API_KEY`                                                                                      |
| Work-email verification | `HUNTER_API_KEY`                                                                                      |
| Adzuna                  | `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `ADZUNA_COUNTRY`                                                   |
| Model/embeddings        | `LLM_BASE_URL`, `LLM_API_KEY`, explicit `LLM_MODEL` and/or `EMBEDDING_MODEL`                          |
| OAuth tokens            | `TOKEN_ENCRYPTION_KEY`: base64-encoded 32 bytes                                                       |
| Google                  | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; Pub/Sub values for push notifications                     |
| Microsoft               | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`                                                      |
| Private object storage  | `S3_BUCKET`, `S3_REGION`, optional `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`          |
| Optional Resend         | `RESEND_API_KEY`, plain verified `EMAIL_FROM`                                                         |
| Real sending            | `ENABLE_LIVE_SEND=true`, configured sender, real verified recipients, and fresh per-campaign approval |

Model operations explicitly disclose that source text is sent to the configured provider and may incur usage charges. Mailbox model classification is separately opt-in. Apollo enrichment and Hunter verification each require confirmation. API configuration status is not proof that your credentials or provider plan have been validated.

## Browser extension

1. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this repository’s `extension/` folder.
2. Generate a pairing token in Orbit’s **Connections**. Enter the Orbit address and token in the extension popup. A deployed HTTPS origin requires a one-time browser permission for that origin.
3. Queue supported opportunities and choose **Open & fill next application**. The extension operates one form per click in your actual browser session.
4. After opening a multi-step form or completing a verification challenge yourself, use **Fill the current application again**. If the lease expires, requeue it in Automation.
5. Review and submit manually. An observed ATS success panel after a submission attempt can confirm Applied; otherwise enter the employer confirmation reference yourself. A Submit click alone stays pending. Revoke extension tokens when finished.

Recognized fields on Greenhouse, Lever, Ashby, Workday and LinkedIn job pages are attempted; custom controls, inaccessible frames or closed shadow roots, login walls, and multi-step flows can require manual completion. Tokens expire in 24 hours and are stored only in the extension’s session storage. CAPTCHA/verification challenges are never solved or bypassed.

## Outreach behavior

Recipients receive individual messages. Sample, suppressed, missing, catch-all, invalid, and unverified addresses are blocked from real sending. **CSV “verified” labels are supplied by your source, not independently validated by Orbit**; use Hunter when independent verification is needed.

Approved messages enter the durable outbox. The worker rechecks the contact, suppression, enabled sending, and approved content before dispatch. Default sending is 30 messages per account per UTC day, at most 50, with 3–8 minute pacing in the configured IANA time zone’s 09:00–11:00 weekday window. The time zone is explicit; the app does not guess a recipient’s location. Provider rules may require lower limits. Native OAuth and pacing do **not** guarantee primary-tab placement or prevent filtering.

One approved follow-up can be queued after four business days. Gmail uses the provider thread ID and reply headers; Outlook uses a reply draft. The worker synchronizes the inbox before a follow-up. A detected reply, suppression, pause, stale/disconnected account, or changed approved content cancels it. Automatic reply detection requires a functioning mailbox connection; Resend-only campaigns do not schedule follow-ups.

Provider `accepted` means request acceptance, not confirmed delivery. Ambiguous network/provider outcomes and interrupted sends become `unknown` and are not automatically repeated. Reconcile them in the provider mailbox/dashboard. Automatic unsubscribe interpretation is not included; record those requests using Suppress.

## Data and migration

API and worker share `DATA_DIR` (default `./data`). On first v0.2 start, the legacy workspace is migrated transactionally into relational tables. Back up the directory before upgrading an existing personal workspace. Original résumé objects are moved out of the active résumé row by the worker into private local files or the configured S3/R2 bucket.

The legacy source table is retained after migration for rollback inspection. Reset clears the active workspace and mailbox credentials, but retained legacy rows and orphaned local/S3 objects are not a complete data-erasure workflow; production retention/deletion remains a milestone. Running tasks block reset.

PostgreSQL/pgvector targets are in `server/db/`. The optional, explicit **core-record export** is:

```bash
# Configure DATABASE_URL for the intended target, then:
npm run db:export-postgres -- --confirm-export
```

This provisions the schema and exports profiles, jobs, applications, contacts, campaigns, résumé metadata, and compatible embeddings. It does not migrate mailbox secrets, task state, inbox history, public links, or file bytes, and does not switch the application runtime. The target embedding column is 1536 dimensions; select and validate your model before a real cutover.

## Docker Compose

```bash
cp .env.example .env
# Set a long WORKSPACE_PASSWORD. Configure PUBLIC_BASE_URL for the intended origin.
docker compose up --build
```

Compose runs API, worker, and Redis with persistent volumes. The API is exposed only at `127.0.0.1:3000`; add an HTTPS reverse proxy for remote use. API and worker must share the SQLite database/private-file volume. This is a personal-workspace deployment, not horizontally scaled multi-user SaaS.

## Verification

```bash
npm run check
npm run build
npm test
```

Tests exercise migration, actual HTTP routes, cross-connection updates/claims, a real separate worker process, private file storage, model/provider response handling, OAuth state/encryption, cursor safety, suppression and duplicate prevention, reply-stopped follow-ups, extension permissions/submission boundaries, and React server rendering/escaping.

Credentialed provider tests, actual Chrome/form interaction and visual QA, Redis/Docker deployment, and PostgreSQL export were not available in this environment. Provider tests use mocks and do not send real email or consume credits. React rendering tests are not a browser test.

See [architecture](docs/ARCHITECTURE.md), [API reference](docs/API.md), and [provider setup](docs/SETUP.md).

## v0.3 hardening

Feature views live under `web/src/features/`. Authenticated `/api/events` streams worker transitions to React. The extension fills open shadow roots and permitted frames and syncs observed ATS confirmations. Both databases enforce unique outreach recipient/sequence steps, and ambiguous sends are held for reconciliation. Mail includes real unsubscribe links and list headers; GET asks for confirmation and POST performs the opt-out. Hunter verification first checks MX records, with temporary DNS failures held for review. Structured AI and embeddings use persistent content/model/provider caches.
