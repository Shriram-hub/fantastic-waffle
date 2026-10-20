# Contact discovery and career tools

## Find contacts without Apollo

Open **Company contacts**. The main finder uses your existing `HUNTER_API_KEY`
and public company careers/contact pages. Apollo remains an advanced option.

1. Choose **My matching job feed** for companies hiring in your saved field, or
   **Company domains I choose** for your own target employers.
2. Set 1–50 companies and 1–5 retained contacts per company. A batch can retain
   up to 250 candidates; this is a cap, not a guaranteed result count.
3. Leave Hunter unchecked for public-only discovery, or explicitly enable
   Hunter search and verification credits. The form shows your daily request
   budget; provider credits, plan eligibility and actual coverage still apply.
4. Click **Find company contacts**. Workers discover and verify in the background.
   Company progress, outcome counts and errors update as tasks finish.
5. Filter the list by status, open **View source**, and use **Related job** to
   inspect the role that triggered discovery.
6. Select contacts and use **Verify selected** or **Draft to verified contacts**.
   Drafts open for review and never send automatically from this workflow.

Hunter searches hiring/executive departments before applying its result limit.
It requests at most ten source records per company, compatible with the Free
plan's first page, and retains the chosen number of relevant contacts. Recent
verified results retain their date and references. A Hunter company-name lookup
can resolve a missing corporate domain only when the returned organization name
matches after normalization. Ambiguous companies become **needs-domain**.

The zero-key fallback reads published recruiting addresses on company careers,
jobs and contact pages and the original listing. It validates and pins public
DNS addresses, uses HTTPS, respects applicable robots rules and limits page size.
A robots-file 404 permits a bounded crawl; blocked or unavailable robots responses
stop it. HTML email entities are decoded. It does not invent addresses or treat
MX records as proof that a mailbox exists.

Public-only discovery can return fewer contacts than paid databases. Consumer
email domains and job boards are not corporate targets. Repeated searches dedupe
by email and preserve suppression.

## Budgets and delivery

**Check provider connections** tests Apollo's zero-credit People Search endpoint
and Hunter's free Account Stats endpoint, caches the outcome for one minute,
and displays a safe diagnosis without account identity or API keys.

- **Automation → Max contact API calls per day** limits reserved lookup attempts
  across discovery and verification. Optional `CONTACT_API_DAILY_LIMIT` supplies
  a server cap from 1–100. These caps do not grant provider credits.
- Completed Hunter calls are cached in seven-day periods. Failed or ambiguous
  requests are held rather than automatically charged again.
- Apollo errors distinguish rejected keys, account/endpoint access, credits and
  rate limits without exposing keys or response bodies. Free Apollo account
  access can require work-email registration and other eligibility requirements.
- With Hunter configured, Autopilot uses Hunter and public fallback without
  first depending on Apollo. Apollo-only installations retain their adapter.
- Hunter verification uses the current `status` field and a timeout that allows
  its verification window. Stale search claims, blocked/disposable/consumer-mail,
  catch-all and unknown results are not upgraded to verified. Provider opt-out
  responses suppress the address.
- Up to 100 selected contacts can enter a verification batch or campaign draft.
  Daily send limits, pacing, unsubscribe, reply-stop and preview controls remain.
  Actual delivery requires a connected mailbox and enabled server sending.

**Export CSV** includes ID, contact details, status, source, reference and job URL.
Imports accept common email/name/company/title aliases from provider exports,
up to 500 rows. Imported verification labels describe supplied data; Orbit's
verification action checks mailbox deliverability independently.

## Planner and interview prep

Open **Planner & interview prep** in the navigation.

- **Action planner:** follow-ups, interviews, assessment deadlines, learning tasks,
  notes, related jobs, completion and overdue status. Overview shows next actions.
- **Calendar export:** download a private `.ics` file of open dated tasks and
  import it into your calendar for that app's notifications. Browser-local due
  dates preserve their exact absolute time. Orbit's reminders are in-app.
- **Interview prep:** generate a job-specific guide without AI credits, or
  explicitly approve using your resume and description with configured Gemini/AI.
  Exact job quotations are checked; unsupported quotes and protected personal
  questions are filtered. Answer notes remain yours to write. Guides cache job
  and resume inputs, and stale worker output cancels.
- **STAR stories:** save your own Situation, Task, Action and Result examples.
  Versioned task/story edits reject stale saves.
- **Search analytics:** current application stages, recorded interviews/offers,
  and submissions in the last seven days against your application target.
  Prepared applications are excluded until submitted.

Records persist privately in the existing SQLite/Postgres workspace. No new
service, public table or API key is required. Bootstrap contains only a small
career summary; full notes, stories and guides use authenticated career endpoints.

References: [Hunter API](https://hunter.io/api-documentation/v2),
[Apollo People API](https://docs.apollo.io/reference/people-api-search).
