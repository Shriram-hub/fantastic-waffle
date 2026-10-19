# Autonomous job discovery and outreach

Open **Automation → Autopilot Mode** on the hosted workspace. Autopilot is off by
default. Save a real profile and parsed résumé first. Add target roles in My
profile, or review the roles derived from the résumé's detected skills.

Choose a minimum explained keyword match (75–100), country for restricted remote
roles, sending time zone, daily email limit (1–50), and 1–3 contacts per company.
Review mode prepares exact job-specific pitches without sending them. Open
**Review pitches**, inspect every message and optional follow-up, then approve
the batch. Full Autopilot requires explicit acknowledgment, contact API access,
credit permission, and a configured sending account with live sending enabled.

No CSV upload is needed. An initial résumé/profile is still necessary to search
and write about the candidate accurately. The engine does not fabricate company
contacts, qualifications, recent news, or application submissions.

## Background pipeline

1. Résumé parsing/profile edits persist a `search_matrices` record. An optional
   schema-checked model ranks supplied role candidates; deterministic derivation
   works without a model key. Changing the résumé/profile invalidates sending
   policy until the owner reviews and saves it again.
2. `autopilot_schedule` reserves `JOB_DISCOVERY_SWEEP` every two hours, across
   worker restarts and cloud ticks. A sweep rotates 10 of 110 checked company
   boards and also visits configured boards. Public feeds are cached: Remotive
   six hours, Himalayas daily per search, Arbeitnow two hours. Up to three target
   roles rotate through Himalayas searches per sweep. Source failures do not
   produce fictional fallback jobs.
3. Greenhouse, Lever, Ashby, Remotive, Arbeitnow, and Himalayas return real jobs.
   Company/title/location fingerprints deduplicate them. Matching jobs enter
   the tracker as **Saved**, not Applied. Each sweep admits at most 30 pipeline
   jobs. Senior roles need an explicitly senior target role; on-site roles must
   match the saved location. Structured country restrictions are checked against
   the country chosen by the owner. A match score does not establish eligibility,
   work authorization, or that an employer accepts every remote location.
4. `AUTO_ENRICH_COMPANY` resolves a catalog domain or an exact, unambiguous
   Clearbit company-name result. Apollo uses the current
   `/api/v1/mixed_people/api_search` endpoint and a separate
   `/api/v1/people/match` enrichment per person. Hunter Domain Search is the
   configured fallback. Each credit-using call is durably reserved first.
5. Corporate-domain equality, suppression, DNS and verification checks filter
   recipients. Apollo-verified corporate addresses can be used without Hunter;
   Hunter can independently verify when configured. Catch-all/invalid/unknown
   results never enter the send queue. A DNS MX result alone never verifies a
   mailbox, and guessed name patterns remain unverified. No SMTP probe service
   is claimed or required.
6. `AUTO_DRAFT_PERSONALIZED_EMAIL` creates a campaign per contact and exact job.
   Templates use saved résumé facts. Optional AI selects short, exact résumé
   excerpts, checked against the source. The résumé is an unlisted seven-day
   share link or the original attachment, as approved in settings. This is not
   an invented tailored PDF. Review mode retains drafts; automatic mode queues
   them under the active owner-approved policy.
7. The shared outbox checks policy, current profile, job activity, résumé-link
   expiry, verification, suppression, approval fingerprint and daily budget
   again. Planned initial sends use weekday 9–11 AM in the chosen time zone and
   4–8 minute spacing; provider delays, business-hour boundaries, and free-host
   cold starts can delay execution further. An address with recent/pending
   outreach is held for 30 days; one company has one prepared role per seven
   days. Email-provider ambiguity is held, never automatically sent twice.

Pausing Autopilot invalidates pending automatic sends. An optional single
follow-up after four business days uses the connected mailbox's existing thread
and stops on a detected reply. The worker refreshes the inbox before a follow-up.
Resend-only campaigns have no automatic follow-up. Assessment/interview tracking
still uses the inbox services and preserves reviewed/terminal-stage rules.

## Provider setup

- `APOLLO_API_KEY` and/or `HUNTER_API_KEY`: needed to obtain real corporate
  contacts. Apollo account/API eligibility and enrichment credits apply.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` or the Microsoft equivalents:
  configure OAuth and connect in Connections. Alternatively configure
  `RESEND_API_KEY` and `EMAIL_FROM` for a verified sender.
- `ENABLE_LIVE_SEND=true`: set only when ready to send. Hosting credentials do
  not grant access to Gmail, Apollo, Hunter, or any AI provider.
- `LLM_API_KEY` and `LLM_MODEL`: optional, used only after AI drafting is enabled.
- `HIMALAYAS_API_KEY`: optional free key for a separate provider allowance.
- `SERPAPI_API_KEY`: optional extra ATS-board discovery. Enable its credit-use
  setting explicitly. These requests share the displayed provider-call cap.

The daily API cap counts reservations, including requests whose outcome is
uncertain. Interrupted/failed paid lookups are held. After checking the provider's
usage, the owner can explicitly release held lookups in Automation. Original
reservations remain in the audit/budget history. Weekly completed responses are
reused instead of spending credits again for the same company/person.

YC/Work at a Startup and Wellfound RSS/JSON integrations are not implemented:
no supported public feed contract was established for this build. Google Custom
Search is not a zero-key replacement (the legacy JSON API is also being sunset).
Clearbit's autocomplete is an as-is service; unavailable/ambiguous results block
lookup rather than guessing a domain. Logo availability is not assumed.

## Free cloud execution

The current Render Free + Supabase Free deployment uses no paid worker or Redis.
Supabase Cron checks every two minutes for genuinely due database tasks or a due
two-hour discovery sweep. Only then does `pg_net` call the signed
`POST /api/internal/autopilot/tick` endpoint to wake the web service/worker.
There is no no-op keepalive. Work remains best-effort: cold starts, quota limits,
provider outages and a paused Supabase project can delay it.

For another deployment:

1. Apply `server/db/runtime.sql`, or the additive `004-autopilot.sql` migration.
   Grant the restricted server role access to the new private tables, enable
   RLS with the server-role-only policy, and keep `orbit_runtime` outside the
   Data API. Existing hosted workspaces use `DATABASE_AUTO_MIGRATE=false`.
2. Generate a random `AUTOPILOT_CRON_SECRET`, set it in Render, and store the
   same value in Supabase Vault as `orbit_scheduler_secret`. Never commit it.
3. Change the host URL in `005-supabase-scheduler.sql` to the intended service,
   review the server-role name, and apply it as the database administrator.
   The dispatcher is not executable by public/anon/authenticated/app roles.
4. Check `cron.job`, `cron.job_run_details` and `net._http_response` for scheduler
   health. The scheduled history cleanup retains seven days of these job logs.

The authenticated `/api/autopilot` response provides blockers, search plan,
next run, held lookups and recent activity. `/api/events` streams task and
Autopilot activity; no provider tokens or message bodies are emitted.

## Validation

`npm run check`, `npm run build`, and `npm test`. Tests exercise SQLite and actual
PostgreSQL semantics via PGlite, queue deduplication, reviewed batches, full-mode
gates, paused sends, provider reservation limits and scheduler authentication.
Paid provider/mail calls in tests are mocks. The board catalog and Himalayas/
Clearbit public response shapes were checked against live endpoints on
2026-10-19. Browser-form submission remains a separate, user-reviewed feature.

Primary references:
- https://docs.apollo.io/reference/people-api-search
- https://docs.apollo.io/reference/people-enrichment
- https://hunter.io/api-documentation/v2
- https://himalayas.app/api
- https://help.clearbit.com/hc/en-us/articles/8502992633111-Autocomplete-Name-to-Domain-and-Risk-API-FAQ
- https://developers.google.com/custom-search/v1/overview
- https://supabase.com/docs/guides/cron
- https://supabase.com/docs/guides/functions/schedule-functions
