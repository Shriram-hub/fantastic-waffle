# Free online first version

Orbit v0.5 can run on a Render Free web service plus a Supabase Free database.
The API supervises a separate worker child process inside the same service.
No PC, paid worker, Redis, S3 bucket, or paid disk is required for this setup.
This remains one password-protected personal workspace, not public multi-tenant SaaS.

## Existing deployment

The hosted service is https://orbit-a1jt.onrender.com.
Use username `orbit` and the `WORKSPACE_PASSWORD` stored in the service's Render
Environment page. Keep this password private. Provider credentials are separate.

## New installation

1. Use the `codex/orbit-prototype` branch. `main` does not contain the application until the PR is merged.
2. Create a Supabase project on a Free organization. In Connect, select the shared pooler in **session mode**, and copy its exact PostgreSQL URI. Supabase connections verify TLS using the bundled official public CA; `DATABASE_SSL_CA` can supply an alternative PEM CA. IPv4-only hosts need this pooler; its cluster index cannot be inferred from region.
3. Create a Render web service with Node runtime and Free plan, or use `render.yaml`. Build: `npm ci && npm run build`. Start: `node server/index.mjs`.
4. Set `HOST=0.0.0.0`, `RUN_EMBEDDED_WORKER=true`, `DATABASE_URL` to the private session-pooler URI, `NODE_VERSION=24`, `DISCOVERY_BOOTSTRAP=true`, and a strong `WORKSPACE_PASSWORD`.
5. The Blueprint generates the encryption secret automatically. For manual setup, generate a stable `TOKEN_ENCRYPTION_KEY` using `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Set it as a secret. Never rotate it without reconnecting mailboxes.
6. Keep `ENABLE_LIVE_SEND=false`. The app uses Render's `RENDER_EXTERNAL_URL` as its public origin automatically; set `PUBLIC_BASE_URL` explicitly for a custom domain.
7. If the DB login can create a private schema, startup provisions `server/db/runtime.sql`. For a restricted app login, apply that SQL as an admin and set `DATABASE_AUTO_MIGRATE=false`; grant that login access only to `orbit_runtime`. Keep this schema private, outside the Data API. Do not use a public/anon key as a database password.
8. Deploy the pushed commit and verify `/api/health`, password protection, a saved profile, and a processed resume task. Restart/redeploy once and verify that saved records and original resume bytes remain available.

The actual runtime uses the `orbit_runtime` PostgreSQL schema. `server/db/postgres.sql`
and the Drizzle schema remain an optional pgvector/core-data export target.
Uploaded resume bytes are private database objects in this free configuration.
S3/R2 remains optional. A blank `DATABASE_URL` selects local SQLite instead.

## Configure features gradually

- Job discovery: choose roles/location once in Discover jobs. Remotive, Arbeitnow, Himalayas, Remote OK, Jobicy and 110 company boards require no keys. Additional board slugs are optional. Google Jobs aggregation uses optional `JSEARCH_API_KEY` or `SERPAPI_API_KEY`, an enabled source toggle, and a separate daily request cap.
- PDF: JavaScript extraction works on native Render without Poppler. Scanned PDFs still need pasted text.
- Gmail/Outlook: configure the provider's OAuth web client. Callback is `https://YOUR-HOST/api/oauth/google/callback` or `/api/oauth/microsoft/callback`. Then connect in Orbit. Connected inboxes poll every 15 minutes without additional push credentials; hosted push webhooks are optional. See the [exact key checklist](API_KEYS.md).
- Contacts: the optional outreach waterfall reuses verified cached contacts, tries approved Apollo/Hunter credits, then looks for public company recruiting addresses. Public or guessed addresses remain unverified and cannot auto-send. No provider guarantees unlimited verified contacts. Render Free blocks outbound SMTP ports, so direct SMTP verification cannot run here.
- AI: keyword matching and fact-preserving printable tailoring work without a model. Structured extraction, AI openers and semantic embeddings need explicitly configured models and keys.
- Outreach: configure a mailbox or Resend, independently verify recipients, review the campaign, and test one inbox you control before enabling intended live sends.
- Extension: load `extension/` on your own Chrome browser, pair the hosted origin, and approve access. The website is hosted remotely; filling an authenticated external form still runs in your browser.

## Free-tier behavior

Render Free sleeps after 15 minutes without inbound traffic. Waking can take about a minute.
The API and embedded worker both stop during sleep; queued tasks persist in PostgreSQL
and resume after wake. Follow-ups and polling are therefore best-effort, not always-on.
Supabase Cron now dispatches real due work through an authenticated endpoint every
two minutes when needed, including scheduled discovery every two hours. No empty
keepalive is installed. See [Autopilot scheduling](AUTOPILOT.md). Supabase Free
can pause after one week of inactivity.
Free hosting does not make Apollo, email verification, or model APIs free.
Respect the providers' published storage, traffic, and usage limits.

References, checked 2026-10-19:
- https://render.com/docs/free
- https://render.com/docs/node-version
- https://supabase.com/pricing
- https://supabase.com/docs/guides/database/connecting-to-postgres
