## Workspace keys and bulk discovery (October 2026)

Open **Connections & Alerts → API keys** to save Hunter, Serper, Tavily, Prospeo,
GetProspect, Minelead or Gemini keys. **Save key** encrypts the value on the server;
**Verify key live** checks access and displays usage where the provider exposes it.
Saved workspace keys override Render environment variables. Remove a workspace key
to use its server fallback. Keys are never returned to the browser. Keep the existing
`TOKEN_ENCRYPTION_KEY`; changing it invalidates encrypted credentials and mailbox tokens.

| Provider | Optional Render fallback | Used for |
| --- | --- | --- |
| Hunter | `HUNTER_API_KEY` | Company search, learned address formats, independent verification |
| Serper | `SERPER_API_KEY` | Google X-ray people search and ATS employer discovery |
| Tavily | `TAVILY_API_KEY` | Alternative web and people search |
| Prospeo | `PROSPEO_API_KEY` | People search and verified corporate email enrichment |
| GetProspect | `GETPROSPECT_API_KEY` | Named email finder; runs in the background |
| Minelead | `MINELEAD_API_KEY` | Company email search and reported address formats |
| Gemini | `LLM_API_KEY` with `LLM_PROVIDER=gemini` | Resume extraction and drafting |

Hunter, Prospeo, GetProspect and Tavily expose account/usage endpoints. Serper and
Minelead live checks issue one search, with a usage notice next to the button;
their balance must be checked in the provider dashboard. Live checks cache for one
minute. Provider plans, credits and sign-up eligibility apply. Any one supported
search provider plus an email finder is enough to start; all providers are optional.
There is no guaranteed free batch of 500 verified addresses.

Serper verification tests a targeted LinkedIn query, rather than a generic query
that can pass while the required capability is unavailable. Some free accounts
reject `site:`/X-ray patterns with HTTP 400, "Query pattern not allowed for free
accounts." The UI reports that account restriction. It is not an invalid-key or
Render error. Use an eligible search provider/plan for those queries; public ATS
feeds and email-provider searches remain independent. Held failed queries are
not automatically charged again.

**Contact Discovery → Bulk Contact Harvester** accepts matching companies, a sector
preset or up to 50 company names/domains. It queues up to 100 matching companies and
15 candidate contacts per company. Separate `CONTACT_SEARCH_DAILY_LIMIT` (100 by
default, maximum 500) and `CONTACT_API_DAILY_LIMIT` (maximum 100) bound API attempts.
These are local limits, not additional provider credits. The per-provider quota still
applies. Public GitHub commits are opt-in, source-linked and unverified.

Google Jobs aggregation still uses JSearch or SerpApi; Serper's organic search is
used for people and ATS discovery, not presented as a Google Jobs API.

See [catalogue architecture and directory attribution](SCALED_DISCOVERY.md).

---

# Keys and setup for the live Render + Supabase app

Open **https://orbit-a1jt.onrender.com**. Hosting stays on Render + Supabase.
Unlock using the existing `WORKSPACE_PASSWORD` from Render, or use your linked
Google sign-in. The main contact finder uses `HUNTER_API_KEY` and public company
pages; Apollo is optional. Planner, calendar export, STAR stories, analytics and
template interview guides need no new key. Gemini practice guides reuse the
existing `LLM_*` settings. See [the feature guide](CONTACT_DISCOVERY.md).

## Where to put credentials

Open [Render → orbit → Environment](https://dashboard.render.com/web/srv-dbafp7uq1p3s73bgqaig/env).
Choose **Add Environment Variable**, enter the exact name and value, then
**Save, rebuild, and deploy**. All provider secrets belong on this server.
Do not put them in React code or give them a `VITE_` prefix.

After deployment, Orbit → **Connections** shows which credentials are present.
Then connect the mailbox there; saved credentials alone do not connect an account.

## Recommended feature credentials

| Feature | Exact Render variables | Get them here | Finish in Orbit |
| --- | --- | --- | --- |
| Google Jobs and available LinkedIn, Indeed, Glassdoor or company application links | **Either** `JSEARCH_API_KEY` **or** `SERPAPI_API_KEY` | [JSearch on RapidAPI](https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch) or [SerpApi](https://serpapi.com/manage-api-key) | Enable **Google Jobs** in job search sources. JSearch needs an active subscription to that API; SerpApi needs search quota. |
| Recruiter search and corporate email enrichment | `APOLLO_API_KEY` | [Apollo API settings](https://app.apollo.io/#/settings/integrations/api) | Enable contact-credit use in Autopilot and set its API limit. API access/enrichment depends on the Apollo account. |
| Company contacts and independent email verification | `HUNTER_API_KEY` | [Hunter API dashboard](https://hunter.io/api) | Enable contact-credit use. Verification requires available quota; catch-all/invalid/unverified addresses are skipped. |
| Public LinkedIn profile snippets and additional ATS search | `SERPAPI_API_KEY` | [SerpApi](https://serpapi.com/manage-api-key) | Enable the optional search-API setting in Autopilot. The same key can serve Google Jobs; JSearch alone does not enable this extra search. |
| Gmail sending and automatic application/reply updates | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | [Google Cloud credentials](https://console.cloud.google.com/apis/credentials) | Create a Web application OAuth client, use the exact callback below, then **Connect Google**. |
| Gemini résumé extraction and personalized pitches | `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL` | [Google AI Studio](https://aistudio.google.com/api-keys) | Save your Gemini key as `LLM_API_KEY` and use the settings below. Enable AI drafting if wanted. |

For Google Jobs and outreach, start with one Google Jobs key, a search provider,
Hunter or another supported email finder, and a Google OAuth client. Apollo is optional. AI is optional: public job discovery,
explained matching, résumé text parsing, factual template drafts and printable
tailoring work without it.

## Gemini settings

The hosted workspace uses Google's native `generateContent` and
`batchEmbedContents` APIs. No OpenAI account, OpenAI key or ChatGPT subscription
is required.

```dotenv
LLM_PROVIDER=gemini
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta
LLM_MODEL=gemini-3.5-flash-lite
LLM_API_KEY=YOUR_GOOGLE_AI_STUDIO_KEY
EMBEDDING_MODEL=gemini-embedding-001
```

`gemini-3.5-flash-lite` is the selected stable model for extraction/classification
and source-checked drafting. `gemini-flash-latest` also routes to Gemini, but
the alias can change and temporarily return overload errors. Embeddings remain
an optional explicit action. AI calls allow up to 60 seconds; other provider
requests retain their shorter timeout. Schema validation and provider/model/input
caches remain active. Google API quotas and account terms apply.
Gemini receives a compact JSON schema without numeric or length bounds to avoid
schema-compiler errors; the complete original Zod schema, including those bounds,
must still pass before any model output is returned or cached.

In Connections, the provider card reads **Gemini AI & embeddings** when these
credentials are configured. Upload/review the résumé, request structured parsing,
and enable AI drafting in Autopilot only if wanted. Inbox AI classification is
a separate option. Adding the provider does not automatically send email or
change existing sending preferences.

Official references: [structured outputs](https://ai.google.dev/gemini-api/docs/generate-content/structured-output),
[embedding API](https://ai.google.dev/api/embeddings),
[model](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite),
[key setup](https://ai.google.dev/gemini-api/docs/api-key).

## Gmail setup, exactly

1. In Google Cloud, select a project and enable **Gmail API**.
2. Configure the OAuth consent screen. If the app is in Testing, add your own
   Gmail address as a test user.
3. Create an OAuth client with application type **Web application**.
4. Add this authorized redirect URI, exactly:

   `https://orbit-a1jt.onrender.com/api/oauth/google/callback`

5. Save its client ID and client secret in Render using the names above and
   redeploy. Keep the existing `TOKEN_ENCRYPTION_KEY` unchanged.
6. In Orbit → Connections, connect Google and consent to `gmail.readonly` and
   `gmail.send`. Choose the connected mailbox in Autopilot.

Connected inboxes are scheduled every 15 minutes. Supabase Cron wakes real due
work when Render is asleep. No Pub/Sub key or service-account JSON is needed
for polling. Free-host cold starts can delay checks.

## Optional alternatives and extras

| Feature | Render variables | Setup |
| --- | --- | --- |
| Outlook instead of Gmail | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | [Microsoft Entra app registrations](https://entra.microsoft.com/). Add Web redirect `https://orbit-a1jt.onrender.com/api/oauth/microsoft/callback`; connect Microsoft in Orbit. Scopes are `offline_access User.Read Mail.Read Mail.Send Mail.ReadWrite`. |
| Resend instead of native mailbox sending | `RESEND_API_KEY`, `EMAIL_FROM` | [Resend API keys](https://resend.com/api-keys). Verify the sender domain. Resend alone does not provide reply detection, so automatic follow-ups require a connected inbox. |
| Semantic embedding matching | `EMBEDDING_MODEL` | Use a supported embedding model from the same configured LLM provider; request semantic matching in the app. |
| Adzuna provider | `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `ADZUNA_COUNTRY` | [Adzuna developer portal](https://developer.adzuna.com/). Optional provider access, separate from the free discovery sources. |
| Optional authenticated Himalayas access | `HIMALAYAS_API_KEY` | Only if Himalayas provides you a credential for its supported API access. The public feed already works without this key. |
| Gmail push instead of relying only on polling | `GOOGLE_PUBSUB_TOPIC`, `GOOGLE_PUBSUB_AUDIENCE`, `GOOGLE_PUBSUB_SERVICE_ACCOUNT` | Configure Google Cloud Pub/Sub and the authenticated notification endpoint. These are a topic resource, OIDC audience and service-account email. |
| S3/R2 résumé storage | `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Optional. Private résumé bytes already persist in Supabase Postgres, so no bucket is needed now. |

## Infrastructure values to keep

These are already part of this deployment; do not replace database credentials
or encryption keys just to enable a new provider.

| Variable | Expected configuration |
| --- | --- |
| `DATABASE_URL` | Existing restricted Supabase session-pooler PostgreSQL URI |
| `DATABASE_AUTO_MIGRATE` | `false`; private schema migrations are applied as admin |
| `WORKSPACE_PASSWORD` | Existing private workspace password |
| `TOKEN_ENCRYPTION_KEY` | Existing stable, base64-encoded 32-byte AES-GCM key |
| `AUTOPILOT_CRON_SECRET` | Existing secret; must match Supabase Vault's `orbit_scheduler_secret` |
| `PUBLIC_BASE_URL` | `https://orbit-a1jt.onrender.com` |
| `HOST` | `0.0.0.0` |
| `NODE_VERSION` | `24` |
| `RUN_EMBEDDED_WORKER` | `true` |
| `DISCOVERY_BOOTSTRAP` | `true` |
| `ENABLE_JOB_DISCOVERY` | `true` |
| `JOB_SEARCH_API_DAILY_LIMIT` | `6` by default; change within your provider quota |
| `ENABLE_LIVE_SEND` | Keep `false` until your mailbox and reviewed recipients are ready; set `true` and redeploy to allow actual sending |

No Supabase `anon`/publishable/service-role key, Supabase platform token, Render
API key, GitHub PAT, Redis key, Vercel token or Neon key is needed by this version.
The backend connects directly through `DATABASE_URL`.

## Make it work

1. Choose target roles/location once, or upload a text-based résumé and review
   the parsed skills. This guides searches; manually entering job links is optional.
2. Live feeds and 110 curated company boards populate automatically and refresh
   every two hours. Watch actual progress/source failures in Discover jobs.
3. Add one Google Jobs key, redeploy, and enable its source to broaden coverage.
   The default six reserved aggregator calls/day are separate from free feed calls.
4. Connect a mailbox. Add Apollo/Hunter, select the sender, and enable Autopilot
   in **review mode**. It finds contacts and prepares job-specific drafts.
5. Check the real recipients and drafts. Set `ENABLE_LIVE_SEND=true` and redeploy
   when ready to send; approve the review batch in Orbit. Full automatic mode has
   its own explicit in-app activation.

Defaults are 40 emails/day, 3–8 minute spacing, and at most three contacts/company
in 14 days. If you enable follow-ups with a connected inbox, one threaded bump
is scheduled after four business days and stops on reply.
These controls reduce risk; no tool can guarantee inbox placement or prevent
every provider suspension. API credits and free hosting have finite allowances.

No keys are needed for Greenhouse, Lever, Ashby, Remotive, Arbeitnow, Himalayas,
Remote OK, Jobicy, the company-board registry, tracking, or the bounded public
careers-page contact fallback. Public/guessed addresses remain unverified.
There is no unlimited free verified-contact or LinkedIn-search API. Render Free
blocks SMTP ports, and DNS MX checks prove neither mailbox ownership nor delivery.

This is one private workspace. Public multi-user SaaS registration/isolation and
unattended submission across every external job board are separate work.
