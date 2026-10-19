# Keys and setup for the live Render + Supabase app

Open **https://orbit-a1jt.onrender.com**. Hosting stays on Render + Supabase.
Sign in as `orbit` with the existing `WORKSPACE_PASSWORD` from Render.

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
| Gmail sending and automatic application/reply updates | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | [Google Cloud credentials](https://console.cloud.google.com/apis/credentials) | Create a Web application OAuth client, use the exact callback below, then **Connect Google**. |
| AI résumé extraction and personalized pitches | `LLM_API_KEY`, `LLM_MODEL`; optional `LLM_BASE_URL` | Your OpenAI-compatible provider's API dashboard | Choose the exact supported model ID and enable AI drafting if wanted. The default base URL is `https://api.openai.com/v1`. |

For the broadest requested features, start with one Google Jobs key, Apollo,
Hunter, and a Google OAuth client. AI is optional: public job discovery,
explained matching, résumé text parsing, factual template drafts and printable
tailoring work without it.

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

Defaults are 40 emails/day, 3–8 minute spacing, at most three contacts/company
in 14 days, one threaded follow-up after four business days, and stop on reply.
These controls reduce risk; no tool can guarantee inbox placement or prevent
every provider suspension. API credits and free hosting have finite allowances.

No keys are needed for Greenhouse, Lever, Ashby, Remotive, Arbeitnow, Himalayas,
Remote OK, Jobicy, the company-board registry, tracking, or the bounded public
careers-page contact fallback. Public/guessed addresses remain unverified.
There is no unlimited free verified-contact or LinkedIn-search API. Render Free
blocks SMTP ports, and DNS MX checks prove neither mailbox ownership nor delivery.

This is one private workspace. Public multi-user SaaS registration/isolation and
unattended submission across every external job board are separate work.
