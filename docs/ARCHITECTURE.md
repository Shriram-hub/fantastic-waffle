# Orbit v0.2 architecture

## Running topology

React/Vite calls a same-origin Node 24 API. The API validates input and writes durable relational records and outbox tasks to SQLite. A separate worker processes CPU-heavy résumé extraction, HTTP provider imports, model requests, inbox sync/classification, verification, and paced email delivery. BullMQ/Redis can dispatch those same durable task IDs; SQLite remains the source of task/domain state.

| Module                       | Responsibility                                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `web/src/App.jsx`            | React workspace views, forms, previews and visible task state.                                                                   |
| `server/index.mjs`           | HTTP boundary, authentication, origin controls, static build, core profile/tracker APIs.                                         |
| `server/upgrades.mjs`        | Queue-oriented APIs, OAuth routes, authenticated webhooks, extension pairing, private/public file routes.                        |
| `server/store.mjs`           | Migration, relational entities/indexes, request-local snapshots, per-record compare-and-swap.                                    |
| `server/queue.mjs`           | Durable tasks, atomic claims, leases, retry/cancel rules, logs, ambiguous-send holds.                                            |
| `server/worker.mjs`          | Task registry, separate worker, optional BullMQ dispatcher, inbox watch renewal.                                                 |
| `server/providers/jobs/`     | Core ATS/public feeds, Ashby/Arbeitnow/Adzuna adapters, canonical deduplication.                                                 |
| `server/providers/contacts/` | Current Apollo search/enrichment; Hunter work-email verification and role targeting.                                             |
| `server/providers/mail/`     | Encrypted OAuth tokens, native MIME/Graph sends, history/delta cursors, watches; optional Resend.                                |
| `server/services/`           | Structured model operations, semantic vectors, fact-preserving tailoring, inbox state machine, outreach, private résumé objects. |
| `extension/`                 | Chrome MV3 pairing and user-initiated form filling.                                                                              |
| `server/db/`                 | Drizzle PostgreSQL/pgvector target schema; export preparation, not runtime cutover.                                              |

## Persistence and concurrency

Profiles, résumés, jobs, applications, contacts, campaigns, and inbox updates each have their own relational table. Each record retains a JSON body for evolving metadata; application job references, unique job tracking, email indexes, stages, and queue scheduling have explicit columns/indexes. This is no longer a single JSON workspace row.

Each API request and worker handler receives a snapshot in AsyncLocalStorage. Saves write only changed records and reject a stale edit to the same row. Independent edits in separate processes do not overwrite one another. Queue claims use an immediate transaction and unique lease token; stale workers cannot finish another worker’s claim.

The durable outbox and campaign approval are committed atomically. Outbound jobs are not automatically reclaimed and resent after an expired lease. Accepted/sending/unknown recipient attempts block duplicates. Retryable read-only work has bounded backoff. Unknown sends require provider reconciliation rather than blind retries.

## Application assistance

The API only queues allowlisted ATS/job-page destinations. A paired extension receives an expiring task lease and the approved profile/answer bank. It fills recognized standard controls, can attach the résumé, and reports missing fields or a challenge. It never presses Submit or invents an eligibility answer. The owner records an employer receipt/reference after submitting. Generic headless submission workers are not implemented.

## Inbox state machine

Authenticated provider notifications are wake-ups. Gmail history IDs and Graph delta links retrieve message data incrementally. Initial Gmail sync captures its starting history cursor before paging, avoiding the loss of messages received during that scan. Notifications and stored message IDs are deduplicated.

Outreach reply detection runs even when a message is not a status update. Application classification is prefiltered by ATS/subject signals or known company/role context. Optional model classification uses a strict schema and exact evidence quote, and is separately enabled because it transmits email content to the model provider.

Automatic stage updates are opt-in. They require a unique role match, current timestamp, a nonterminal existing state, and a supported forward transition. Ambiguous, old, or terminal-stage messages remain in review. The model does not choose an arbitrary application ID.

## Résumé matching and generation

Keyword scores explain their inputs. Optional embedding requests compute real cosine similarity, cache model/content fingerprints, and invalidate displayed scores when the résumé or job text changes. SQLite stores vectors for this first stage. The PostgreSQL target defines a pgvector cosine index with 1536 dimensions and must be adapted to the selected model before migration.

Structured extraction produces suggestions, never an automatic profile overwrite. The Tailor action highlights and reorders relevant existing bullets verbatim and retains the original text. It creates a printable HTML version rather than inventing missing skills or experience. A reviewed browser print can save it as PDF.

## Outreach lifecycle

Campaign previews include the sender account, each personalized message, attachment, and follow-up text. Approval binds to those inputs. Sending is opt-in at the server and campaign levels. A durable queue enforces caps, business windows, and paced dispatch, with a shared account budget/lease so multiple workers do not burst sends together.

One approved follow-up uses native thread identifiers, checks the inbox before dispatch, and stops on a detected reply, suppression, pause, invalid approval, missing account, or unknown original send. Recipient verification provenance remains visible: imported labels are not independent Orbit verification. Link-request counts are not presented as recruiter reads.

## Production work still required

Multi-user account sign-in, tenant isolation, async PostgreSQL repositories and runtime cutover, paginated SQL queries for large datasets, bounce/delivery webhooks, comprehensive unsubscribe handling, file-retention/deletion, real provider acceptance tests, Chrome/form QA, Redis/Docker validation, and operational backup/restore remain required before offering a public SaaS service.

Mailbox OAuth is account authorization for a personal workspace. Basic Authentication is retained for the workspace owner; it is not presented as Clerk/NextAuth or a multi-user login system.
