# Field-aware targeting and expanded discovery

Veloce AI 0.6 keeps the existing Render web service, embedded worker and private Supabase database. No infrastructure migration or new mandatory secret is needed.

## Start using it

1. In Jobs, save your target roles, cities, country and experience. Run **Find new jobs**, or let the two-hour scheduler run. Jobs are discovered without enabling outreach.
2. In Connections, review discovery sources. The catalog contains 167 employer career-page references across eight ATS families. Source health records actual successes and failures, including zero results and blocked endpoints.
3. Add an employer URL under **Monitor a company career page**. The API queues a public-access probe, detects supported ATS URLs, or extracts Schema.org JobPosting data. An active source joins the next discovery sweep. Pages without readable data, pages disallowed by robots.txt and access walls remain unavailable.
4. Use **First-Mover (<24h)** in Jobs for roles with a real source posting date. Refresh times and Greenhouse update times never qualify. Workday relative labels without an exact timestamp do not qualify either.
5. In Contact Discovery or a job's **Auto-pitch company** dialog, choose a target persona. Prepare drafts, verify mailboxes, and review the recipient list and campaign before sending. Existing Autopilot consent, sender limits, idempotency, unsubscribe and reply-stop controls continue to apply.

## What targeting does

The job title and department take precedence over general profile preferences. The five families are finance/accounting, software/AI/data, product/design, marketing/growth/sales, and consulting/strategy/operations. Every search plan contains functional leaders (60 priority points), specialist recruiters (25) and peers (15). Published reporting lines or posting authors lead the query. Public hiring-post signals add 25 points and retain the source URL and quote.

A post about an employer does not establish that its author works there. Such authors can appear as LinkedIn prospects, but do not receive guessed corporate emails unless there is separate employer evidence. Public search is best effort and never creates missing people or bypasses a sign-in wall.

Manager drafts lead with relevant work copied from the candidate's résumé; recruiter drafts list supported role-fit evidence; peer drafts request ten minutes of advice or a referral if appropriate. The draft-angle control can override the automatic choice for the next preparation. LinkedIn notes remain below 200 characters and DMs below 450. Unsupported achievements, work samples, performance metrics and shared backgrounds are not invented.

## Email patterns are evidence, not verification

Named addresses from company pages, Hunter/Apollo results, verified contacts and matching-company incoming mail can establish a naming-pattern observation. Observations persist in the private `companies` record. Repeated independent addresses can corroborate a pattern; ambiguous or conflicting formats stay labeled as such.

A learned pattern is tried first when generating candidates. Every inferred address remains unverified. One observed address cannot justify a 95% mailbox-confidence claim. MX records only show that a domain receives mail. Catch-all, invalid, suppressed and unverified addresses remain excluded from sending.

## Sources and optional keys

| Feature | Render environment variable | Notes |
| --- | --- | --- |
| Employer ATS feeds | None | Greenhouse, Lever US/EU, Ashby, SmartRecruiters, Workable widget, Recruitee and public Workday CXS. Availability varies by employer. |
| Remote and structured career feeds | None | Remotive, Arbeitnow, Remote OK, Jobicy, Himalayas, structured career pages and public VC portfolio pages/ATS links. |
| The Muse | `MUSE_API_KEY` optional | Public access is attempted first. Add a developer key if the provider requires it; failures remain visible. |
| Adzuna | `ADZUNA_APP_ID`, `ADZUNA_API_KEY` | Optional. Existing `ADZUNA_APP_KEY` is also supported. Uses your country preference, including IN, US, GB and SG. Enable Adzuna in discovery settings after adding keys. Provider quotas and country availability apply. |
| Google Jobs, regional indexing, optional people search | Existing `SERPAPI_API_KEY` or applicable JSearch/Brave key | Existing daily budgets apply. People search uses credits only when explicitly selected or covered by saved Autopilot consent. |
| Corporate email discovery/verification | Existing `HUNTER_API_KEY`; Apollo optional | Field-specific Hunter departments replace HR-only targeting for job-linked searches. Apollo access still depends on its account plan and permissions. |
| AI evidence selection | Existing Gemini `LLM_*` variables | Factual persona templates also work without an LLM call. |

Add secrets in the existing Render service's **Environment** settings, then save/redeploy. Keep keys out of browser settings, source files and GitHub commits. The existing database, Google OAuth, encryption, mailbox and scheduler configuration stays in place.

## Capacity and limits

The retained index cap is 15,000 roles, ten times the former 1,500 cap, plus roles pinned by applications or outreach. This is a capacity improvement, not a promise of ten times as many relevant vacancies or higher reply rates. Source availability, geography, role preferences and provider quotas determine actual results.

Descriptions are retained in compressed source caches and hydrated for job detail, document generation and pitch preparation. The main index keeps a 280-character excerpt and source-backed matching terms. Very long descriptions are bounded at 10,000 characters in the source cache; read the original listing for complete requirements. Initial workspace loading returns up to 500 top jobs plus linked records. The job feed and command palette search the entire retained index through the authenticated paginated API.

Discovery uses two shared network slots, including fan-out adapters. LinkedIn guest search attempts three pages under a four-second per-page deadline. Source failures do not archive unrelated listings. Partial/search ATS pages do not constitute a full board snapshot. Snapshots use linear-time record lookup during persistence.

No public provider is assumed unlimited or permanently accessible. VC boards that expose only a script-rendered page can report unavailable; add a portfolio employer's supported ATS URL instead.

## Verification

`npm test`, `npm run check`, and `npm run build` cover the adapters, field mapping, reporting lines, hiring signals, pattern evidence, full-index pagination, freshness, persona drafts and existing workspace behavior. Local browser checks use synthetic records and mocked provider responses; they send no outreach and consume no provider credits.
