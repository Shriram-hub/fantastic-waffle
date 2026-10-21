# Using the hardened Orbit workspace

Orbit continues to use Render and Supabase. No Vercel, Neon, Redis service, SMTP server or extra paid worker is required by this release.

## Start with a real profile

New databases start empty. Existing sample workspaces have **Connections → Clear demo / seed data**. This removes sample records and their application tasks; it retains real records and connected mailboxes. Workspace reset is a separate, broader action.

Upload the original PDF, DOCX or TXT in Profile. PDF extraction uses `unpdf` asynchronously, including compressed text streams; DOCX extraction reads the bounded, compressed `word/document.xml` entry without extracting files onto disk. The original bytes are retained separately from extracted text and checked when read. Image-only PDFs require pasted text or OCR outside this version. Review Gemini’s extracted profile before using it in applications.

## Contact discovery when providers fail

Company resolution cleans legal, regional and job-board suffixes, checks saved companies and curated official corporate references, uses company website/application URLs, and tries Clearbit with a four-second deadline. Guessed domains can be probed using HTTPS DNS, but **a working domain is not proof of which company owns it**. Those suggestions require confirmation before outreach.

Contact lookup reuses verified contacts, optionally uses Hunter, then checks permitted public company careers/contact/about/team/leadership pages. Source-supported people can also come from SerpApi or Brave when approved, and bounded public DuckDuckGo/Yahoo results when available. HTTP blocks and challenges are treated as unavailable sources. Orbit does not route around access restrictions or pretend a search is unlimited.

Hunter domain patterns are retained even when a successful response contains no people. Public page/search results are cached for a day; paid requests retain their existing durable reservation and result cache. Provider failures show the actual HTTP category without exposing the key or response body. Apollo access failure does not stop the fallback path.

If no published address is available, a domain with MX records can produce explicitly labeled hiring-inbox suggestions such as `careers@…`. Named people may have pattern suggestions. These are useful leads, **not verified mailboxes**:

| Signal | What it proves | Sendable? |
| --- | --- | --- |
| Public profile or leadership page | A name/role was published at a recorded source | Requires a verified email |
| Published company email | The company published that address | Requires mailbox verification |
| MX records | The domain has mail routing | No |
| Generated name or role pattern | A possible address | No |
| Recent, acceptable mailbox-provider verification | A corporate mailbox passed the provider’s check | Yes, with campaign approval and sending enabled |

There are no outbound SMTP/Port 25 probes. DNS has a three-second native deadline and Google DNS-over-HTTPS fallback. Google Workspace, Microsoft 365, Zoho and enterprise gateways are displayed as domain metadata. Timeouts never label a guessed mailbox invalid. Null MX and nonexistent domains are rejected. Catch-all addresses remain blocked.

AI memory is not used to invent current recruiters or email addresses. Gemini selects candidate résumé evidence and drafts from saved facts; actual people need a source. For companies inaccessible to server search, open their LinkedIn People page, load the relevant visible profiles, and use the extension’s **Pull company recruiters to Orbit** action. It imports up to 25 visible names, roles and links; email patterns remain unverified. Use Verify selected in Contacts to approve Hunter verification credits.

## One company pitch from a job card

1. Click **Auto-pitch company** on a real job. Confirm the source listing if it is an indexed lead.
2. Use free sources, or explicitly select Hunter/search/Gemini usage. An optional corporate domain must be one you have checked.
3. The queue finds prospects, creates a private job-specific résumé and cover letter, and drafts a separate introduction for each contact using the exact role and supported warm connections.
4. Review contacts and both PDFs in the same modal. Verify unknown mailboxes, then review the sequence for verified contacts.
5. **Queue sequence & open application** schedules the approved messages and opens the employer form. You complete the final application submission yourself.

No mail is sent by preparation alone. Existing unsubscribe, daily cap, business-hour window, paced sending, unknown-acceptance holds and company-reply cancellation remain enforced. Follow-ups stay in the same Gmail/Outlook thread. Downloaded `.eml` drafts include the selected tailored PDFs rather than silently substituting the original file.

## Worker and mailbox checks

The API starts a supervised worker child process **by default** on the same Render instance. `ENABLE_EMBEDDED_WORKER=false` disables it; legacy `RUN_EMBEDDED_WORKER` is honored when the new setting is absent. Docker Compose explicitly disables the embedded child because it has a separate worker container. PostgreSQL claims use `FOR UPDATE SKIP LOCKED` and lease fencing.

**Process queued tasks now** wakes the worker. It processes due work, retains scheduled delays and never bypasses review or sending limits. A bounded in-process drain is available when a separate worker is not connected. Free hosting can suspend/restart a process; the database queue and existing signed scheduler preserve work across those interruptions.

Connect Google/Gmail or Microsoft/Outlook using OAuth. This app sends and scans over HTTPS APIs, so SMTP/IMAP App Passwords and SMTP port restrictions do not apply. Connections includes **Send test to myself** and **Test inbox scan**, with results under each mailbox and in Automation. The send test requires an explicit click and sends only to that connected mailbox; retries within ten minutes reuse the same task. Unknown send acceptance is not automatically retried. Campaign sending can remain disabled while testing your own mailbox.

The callback derives from the configured public app URL or incoming host, and is stored with the OAuth flow so host/config changes cannot change it midway. For the existing service, register exactly:

`https://orbit-a1jt.onrender.com/api/oauth/google/callback`

Google Cloud must still allow that callback, enable Gmail API for mailbox operations, and grant the requested scopes. A redirect URI cannot be registered automatically by the app. Sanitized errors distinguish disabled APIs, missing scopes, revoked grants and quotas. Reconnect the mailbox after fixing its Google/Microsoft grant.

## Extension 0.8

Download from Connections while signed in. Unzip and load `orbit-extension` from `chrome://extensions` with Developer mode enabled, or reload the installed folder after replacing its files.

The ZIP includes this deployment’s address and a one-use installation code expiring in 15 minutes. It contains no workspace password, API keys, Google tokens or reusable workspace login session. On installation the code can be redeemed for a revocable 24-hour extension token. After a browser restart or expired code, refresh Orbit and click **Pair extension with this workspace**. The isolated bridge requests a scoped token through the signed-in page; it does not copy credentials into the website’s localStorage or broadcast them in page messages.

Only capability-protected extension endpoints have extension-origin CORS. Normal private workspace APIs still require owner authentication. Revoking extension tokens also invalidates unused installation codes. Application batches remain sequential and wait for your real submission and an ATS confirmation before advancing.

## Keys and settings

Save secrets only in **Render → Environment**, never in the browser or repository. Keep the existing working values; no new key is mandatory for this release.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Existing private Supabase PostgreSQL connection |
| `WORKSPACE_PASSWORD`, `TOKEN_ENCRYPTION_KEY` | Workspace access and encryption; keep existing values |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in and Gmail OAuth |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | Optional Outlook connection |
| `PUBLIC_BASE_URL` or `PUBLIC_APP_URL` | Public HTTPS app origin; Render external URL is also recognized |
| `OAUTH_REDIRECT_URI` | Optional explicit Google callback override |
| `LLM_PROVIDER=gemini`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL` | Existing Gemini configuration |
| `HUNTER_API_KEY` | Optional company email lookup and mailbox verification; plan credits still apply |
| `SERPAPI_API_KEY` | Existing Google Jobs, regional discovery, people and warm-connection search |
| `BRAVE_SEARCH_API_KEY` | Optional alternative people/web search API; not required |
| `JSEARCH_API_KEY` | Optional Google Jobs provider; it is not a people-search API |
| `APOLLO_API_KEY` | Optional advanced provider; restricted keys do not block other sources |
| `ENABLE_EMBEDDED_WORKER` | Defaults to `true`; use `false` with a separate worker |
| `FREE_CONTACT_WEB_SEARCH` | Defaults to `true`; set `false` to use company pages without public search-engine requests |
| `JOB_SEARCH_API_DAILY_LIMIT` | Shared optional search request budget, default 6, maximum 30 |
| `CONTACT_API_DAILY_LIMIT` | Contact-provider request cap; does not add provider plan credits |
| `ENABLE_LIVE_SEND` | `false` keeps campaigns in review; only enable when ready for real approved sends |

Phone-alert destination settings and provider credentials remain optional and are entered in Connections. This release does not send a test notification or outreach campaign during deployment.

## Backups and verification

Contacts exports include names, roles, company, email status, source references, LinkedIn URL, confidence when actually available, domain and MX health. Application exports include stage and notes. Both CSV exports neutralize spreadsheet formulas. Contacts CSV import and the new application CSV import retain review safeguards and deduplicate existing records. A CSV import does not turn an unknown address into a provider-verified mailbox.

Run `npm test`, `npm run check` and `npm run build`. The regression suite includes blocked search/no-key fallback, noisy names, HTTPS DNS, one-use pairing/CORS, real PDF/DOCX bytes, company-pitch orchestration, worker scheduling, native OAuth self-tests and backup restore. Browser form support still varies by ATS; a passing mock DOM test is not a claim that every live portal has been tested.
