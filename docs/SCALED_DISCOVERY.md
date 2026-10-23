# Job catalogue and contact discovery

The Render web API and supervised worker share the private Supabase PostgreSQL
database. No Vercel, Neon or extra paid worker is required. `JOB_CATALOG_ENABLED=true`
enables the database catalogue, initially imports existing postings and starts a
weekly employer-directory import. Existing job discovery still runs every two hours.

## Capacity and availability

`job_catalog` holds up to 250,000 deduplicated postings outside workspace snapshots.
The API returns at most 100 rows per request with search-bound keyset cursors. Only
1,500 ranked jobs plus tracked/contact/document-related jobs remain in the working
workspace. Saving a role materializes that selected record before attaching an
application or contact. This keeps database capacity separate from process memory.

The UI reports **actual live listings**, **catalogue capacity**, **employer references**
and **source health** separately. A directory reference is a candidate for a live
public-board check, not a verified employer or an open job. The job count grows as
real sources succeed; this migration does not create 250,000 fictional jobs.

The catalogue pauses new writes at `JOB_DATABASE_BUDGET_MB` (440 MiB by default).
Free hosting has finite database space and can sleep; a capacity test does not
guarantee all 250,000 postings fit a particular free database or that the worker
runs continuously. Closed catalogue postings can be evicted at capacity. Full
native board snapshots archive missing postings; partial/query pages do not.

Source response caches are gzip-compressed and periodically capped at 32 MiB.
Full cached descriptions remain available for selected roles while retained;
snippets are marked as truncated when full source data is unavailable. A snippet
does not become evidence of requirements absent from the actual source.

## Sources

- Public Greenhouse, Lever, Ashby, Workable, Recruitee, SmartRecruiters and Workday
  endpoints; Workday and SmartRecruiters follow real pagination up to 500 pages.
- Keka public portal bootstrap and active-jobs endpoint, Darwinbox public jobs
  responses, Freshteam's public widget feed, and readable Zoho Recruit JSON-LD.
  Restricted, CAPTCHA or dynamic-only boards are reported as unavailable.
- Amazon Jobs' public search JSON, by target role and individual location.
- Existing public remote feeds and five LinkedIn guest pages per role/location.
- Optional Serper, Tavily or SerpApi web search expands supported ATS references.
  Existing Google Jobs aggregation remains a separate JSearch/SerpApi integration.

Directory downloads stream in small batches, enforce byte/row limits and never
load an entire employer directory into the workspace. The bundled registry has
487 sourced employer references, including 320 India-focused additions. Fresh
network checks determine availability; ordinary requests do not bypass access controls.

## Contact provenance

Hunter fetches an unfiltered first page, sanitizes domains and prioritizes contacts
locally. Its reported address format is saved independently of observed samples.
Serper/Tavily provide source-backed names; Prospeo/GetProspect/Minelead can enrich
them subject to explicit credit use. Distinct provider requests run concurrently
where safe, with reservations before credit-consuming calls. Ambiguous failures
stay held rather than silently repeating charges. A replacement key uses a new
reservation identity.

DNS/MX records, public source addresses, GitHub commit emails and inferred address
formats never prove mailbox deliverability. They remain unverified. Catch-all,
invalid, suppressed and unverified contacts stay excluded from live sending.
Bulk harvesting creates contacts only; existing approval, pacing, unsubscribe,
reply-stop and sending controls continue to apply.

## Directory attribution

Employer references are imported from:

- [moonie0201/ats-directory](https://github.com/moonie0201/ats-directory), CC0-1.0.
- [Continuity1/d1_ats_scrapers](https://github.com/Continuity1/d1_ats_scrapers),
  MIT, copyright (c) 2026 Kalil Bouzigues. Bundled India references record the
  original directory URL and license individually.

The MIT notice for these references follows:

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

## Database upgrade

Apply `supabase/migrations/20261023074155_provider_catalog.sql` through a database
administrator before deploying with `DATABASE_AUTO_MIGRATE=false`. The three new
tables are private, have RLS and grant access only to the server role `orbit_app`.
No keys or private catalogue bodies are exposed to Supabase anonymous clients.

Verification includes provider contracts, key encryption and priority, authenticated
bulk APIs, parallel discovery, catalogue deduplication and cursor filtering,
PostgreSQL persistence, a 250,000-row disk catalogue, and a zero-emoji UI/source audit.
