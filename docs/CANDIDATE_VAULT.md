# Candidate vault and application assistant

The workspace is hosted on Render and stores candidate data privately in Supabase
PostgreSQL. Your computer does not run the backend. The Chrome assistant runs
inside your browser when you choose an application or import your own profile.

## Set up once

1. Open **Profile & résumé** and upload PDF, DOCX or TXT (up to 5 MB).
   Text extraction is queued. Deterministic parsing fills available fields;
   configured Gemini performs deeper structured extraction in a separate task.
2. Review **Your candidate vault**: personal details, links, experience,
   education, skills, projects, certifications and screening defaults.
   Save corrections once. Unknown values remain blank or null.
3. Import LinkedIn using its **Save to PDF** export, pasted profile text, or the
   assistant's **Sync My LinkedIn Profile** action. Expand the sections you want
   included before syncing your own logged-in profile. A URL alone saves its link;
   the server does not use it to scrape private profile data.
4. Imports fill missing fields and merge distinct entries. They preserve saved
   values and explicit No/zero answers. LinkedIn exports do not replace the résumé
   file used for applications. A stale open editor cannot overwrite a newer import.

The normalized master record is stored inside the existing private profile JSON,
so it persists on both SQLite and PostgreSQL without a destructive schema migration.
Only explicitly supplied eligibility and demographic answers can be used.

## Find roles across fields and cities

Enter roles and city alternatives in Discover jobs, for example:
`Financial Analyst, Accountant, Investment Banking` and
`Mumbai or Bengaluru or Delhi`.

Each city and internship/entry-level preference reaches the targeted providers
before local filtering. Indian metro aliases and
finance/accounting role families improve matching. Strong role/location fits and
adjacent opportunities are labeled separately. Wrong-country restrictions and
experience constraints are retained; unrelated local jobs are not counted as fits.
Adjacent roles do not qualify for automatic pitching through the strong-fit gate.

Enable **Google Jobs** under search sources after configuring SerpApi or JSearch.
Targeted sources run before the broader ATS sweep. The existing API-credit budget,
cache, queue and two-hour schedule remain active. The default search budget is six
new metered requests per day, shared across the job aggregators, not unlimited search.
Queries visit different cities before moving to the next target role.

LinkedIn Guest is an optional, bounded public-card provider with no key. A block,
sign-in challenge or unrecognized response is reported in source health, while other
sources continue. There is no supported unlimited, keyless Google Jobs RSS feed in
this implementation, and no guarantee that every city/role combination has openings.

## Install or update the assistant

1. In **Connections → Browser application assistant**, download the ZIP and extract it.
2. Open `chrome://extensions`, enable Developer mode, then **Load unpacked** and
   choose `orbit-extension`. For an existing installation, replace its files and reload it.
3. Generate a pairing token in Orbit. Pair with the hosted Orbit URL in the popup.
   The token expires after 24 hours and stays in Chrome session storage.
4. Queue applications in Orbit, then choose **Open & fill next application**.
   For custom portals, use **Fill this page** and grant access to that origin.
5. Choose **Auto-add & fill all history entries** to create supported experience
   and education blocks. Native inputs/selects, recognized radio/checkbox questions,
   open shadow roots and permitted frames are supported. Existing typed answers are
   preserved. Original résumé bytes are attached where the file field accepts them.
6. **Suggest supported answers with Gemini** selects exact professional excerpts
   for suitable empty text questions in a queued application. Unsupported questions,
   eligibility, demographic choices and assessments are left for you.
7. Review every field and submit yourself. Only a subsequent matching ATS success
   panel can confirm submission in the tracker.

The assistant cannot inspect closed shadow roots, solve CAPTCHA, or guarantee
compatibility with every custom widget, date picker or multi-step portal. An exact
day is not invented for employment dates when only month/year is known. Remaining
fields and frame-permission issues require your input. There is no server-side
browser bot or anti-bot evasion fallback.
