# Orbit v0.3 runtime

Orbit is a private, single-user workspace with a React/Vite frontend, HTTP API,
worker process, and companion Chrome extension. It does not yet implement public
SaaS tenant registration or isolation.

## Persistence

`openConfiguredStore` selects local relational SQLite or remote PostgreSQL when
`DATABASE_URL` is present. PostgreSQL stores the live workspace in `orbit_runtime`
with compare-and-swap record writes, a serialized workspace write lock, and atomic
queue claims using `FOR UPDATE SKIP LOCKED`. The free deployment uses a restricted
`orbit_app` login with private-schema RLS policies, not a public Supabase API key.
Resume objects live in the private database for this configuration; local private
files and S3/R2 remain supported. OAuth secrets use random-IV AES-256-GCM.

`server/db/runtime.sql` is the actual private-workspace runtime schema.
`server/db/postgres.sql`, Drizzle and the pgvector exporter are a separate optional
export representation. They do not replace the runtime schema or provide SaaS auth.

## Work and events

The API enqueues slow operations and returns immediately. A separate worker leases,
heartbeats and finishes durable tasks. `RUN_EMBEDDED_WORKER=true` supervises that
worker as a child process inside one hosting service. Compose keeps API and worker
in separate containers. Optional Redis dispatch uses the same durable task records.

Expired read tasks can retry. Interrupted outbound tasks become unknown and require
reconciliation. The unique send log reserves user, normalized recipient, campaign
and sequence step before outbound I/O; follow-ups have their own step. Sending also
checks approved content, verification, suppression, reply state, shared daily
budgets, business hours and randomized pacing. Provider acceptance is not delivery.

Authenticated `/api/events` serves SSE task transitions from a single shared database
watcher. React refreshes views and shows completion/failure toasts without periodic
browser polling. The watcher supports workers in another process. Events omit mail
payloads, provider secrets and resumes.

## Mail and models

Mailbox synchronization uses Gmail history cursors and Graph delta links, with
optional authenticated push notifications and subscription renewal. Updates remain
reviewable unless the owner enables supported automatic transitions. Replies stop
follow-ups; explicit unsubscribe replies suppress the contact. Opaque opt-out links
show a confirmation on GET and suppress on POST, including RFC one-click requests.
Native MIME and Resend carry list unsubscribe and reply/reference headers.

Verification checks MX before using Hunter; temporary DNS errors are held, not
marked verified or permanently invalid. No SMTP probing or CAPTCHA solving is used.
Structured model output is schema-validated and persistently cached by full input,
schema, provider, model and instruction. Embeddings cache exact text/model/provider
fingerprints. Printable tailoring reorders existing bullets without inventing facts.
Resume HTML remains semantic and single-column with no flex/grid reading-order traps.

## Browser assistant

The API queues approved public HTTPS application destinations. The browser grants
custom portals per-origin access. An expiring paired token receives one task, its
normalized candidate vault, original resume, and answer bank. Native prototype setters
trigger input/change events. Filling traverses open shadow roots and permitted
frames; closed roots, inaccessible frames and custom multi-step controls may need
manual input. Recognized repeating blocks, native/ARIA choices, and résumé file inputs
are filled from saved facts. Optional Gemini suggestions select verbatim professional
excerpts, leaving unsupported and sensitive questions for the user. It never clicks Submit.

A user Submit attempt records pending status. A subsequent explicit ATS success
panel in the same queued tab/origin can confirm Applied. The backend checks the
lease, origin, prior attempt and confirmation evidence. Otherwise the owner records
the employer receipt manually. A button click alone cannot confirm an application.

## Free hosting limits

Render Free sleeps, pausing the API and embedded worker. Durable tasks and files
survive in PostgreSQL and resume on wake. This is a usable personal pilot, not an
always-on scheduling guarantee. See [free hosting](FREE_HOSTING.md).
