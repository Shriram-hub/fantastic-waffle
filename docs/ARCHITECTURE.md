# Orbit v0.1: implementation and next milestones

## Product boundary

The first prototype is a working personal workspace with explicit sample data and optional external adapters. It validates the job-seeker journey before building a multi-user SaaS product. User data remains on the app server; browsers receive only public workspace fields. Provider credentials are never committed or returned by the API.

## Architecture

| Layer       | Implementation                                                   | Why                                                                     |
| ----------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Interface   | HTML, responsive CSS, browser ES modules, hash navigation        | No bundler, framework, client dependencies, or external asset services. |
| API         | Node 24 HTTP server, fixed routes, JSON validation               | One start command; no separate frontend/backend deployment.             |
| Persistence | Native `node:sqlite`, one versioned workspace document           | Durable state with atomic document updates; no database provisioning.   |
| Files       | Original résumé bytes in the private database                    | No public upload directory; file download is authenticated.             |
| Job sources | Fixed provider hosts and validated company-board slugs           | No arbitrary server fetch endpoints or job-board scraping.              |
| Contacts    | Manual/CSV input plus separate Apollo search/enrichment          | Distinguishes finding people from paying for and verifying an email.    |
| Messaging   | Personalized preview snapshots, Resend, durable recipient states | Approval binds to the actual content and recipients.                    |

## State transitions

The workspace holds a profile, résumé, jobs, applications, contacts, campaigns, email updates, settings, source refresh records, and expiring previews. User-created records use UUIDs; job IDs include the provider and company slug.

An application has a job, stage, notes, timestamps, and history. Batch preparation only changes Saved/Ready stages. It never overwrites Applied, Interview, Offer, Rejected, or Withdrawn. Users record actual submission after completing the employer’s form.

Campaigns move from Draft to Reviewed and, if configured and approved, to Accepted by provider or Needs attention. Per-recipient states are `sending`, `accepted`, `failed`, or `unknown`. A record is saved before each request. On restart, `sending` becomes `unknown`. Accepted/sending/unknown recipients are not automatically repeated. Explicit provider rejections can be retried with the stable idempotency key. Campaigns with delivery attempts cannot be edited.

Email import creates a suggestion. Users explicitly link the message to an application and approve or dismiss the suggested stage.

## Controls implemented

Local binding is the default. Remote binding requires a workspace password, and optional `ALLOWED_HOSTS` is supported. Writes require JSON and reject cross-origin/cross-site requests. Static paths are allowlisted, uploaded files are not served as web content, and user text is escaped under a restrictive Content Security Policy. CSV exports neutralize leading spreadsheet formula characters.

Résumé uploads have size, type, and signature checks. DOCX extraction reads a bounded ZIP entry without extracting paths. PDF extraction invokes an installed executable with fixed arguments, a timeout, and no shell. No uploaded code or macros execute.

## Known limits

SQLite stores one workspace per database, so migrate before large datasets or concurrent users. Single-process locks do not coordinate multiple server instances. Sends happen within a request rather than a durable queue. Daily limits use UTC. Connection statuses indicate configuration, not verified credentials. Greenhouse/Lever cover selected company boards, not every employer. Work mode may be inferred from location text and must be checked on the original posting.

No real browser visual/interaction pass or credentialed provider verification was available in this environment. Automated rendering checks run in Node, not a browser. Adapter tests use documented response shapes rather than your provider plan access.

## Next implementation milestones

| Milestone                         | Deliverable                                                                                       | Completion check                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Browser and provider verification | Desktop/mobile QA, read-only job/Apollo smoke tests, one controlled email to an owned test inbox  | Record screenshots, API access results, attachment delivery, and errors.                     |
| Accounts and private storage      | Sign-in, per-user relational records, private file storage, deletion                              | Two accounts cannot read one another’s data.                                                 |
| Wider job coverage                | Licensed aggregator APIs, cross-source deduplication, freshness checks, saved searches            | Listings have source URLs, timestamps, and explicit eligibility information.                 |
| Inbox connections                 | Gmail/Microsoft OAuth, encrypted tokens, incremental sync, reviewed role matching                 | A real email yields a reviewable update for the correct role.                                |
| Durable outreach                  | Background queue, verified provider webhooks, unsubscribe/bounce processing, pause/reconciliation | Restarts cannot duplicate a send; acceptance, delivery, bounce, and reply remain distinct.   |
| Assisted application completion   | Supported per-ATS adapters, field mapping, tailoring, review before submission                    | Missing screening/eligibility answers block submission; a confirmation ID proves submission. |
| Production operations             | Deployment, backups/restore, migrations, monitoring, quotas and billing, accessibility review     | Restore a workspace and complete the journey with an independent account.                    |

Automatic job application support depends on employer/ATS access and variable screening questions. Implement and verify it per provider rather than claiming universal one-click submission.
