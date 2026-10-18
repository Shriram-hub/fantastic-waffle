# Orbit · Your next chapter

A runnable first prototype for finding relevant jobs, preparing multiple applications, tracking progress, sourcing company contacts, and sending reviewed, personalized résumé outreach.

The app opens with a **clearly labeled fictional sample workspace**. Choose **Start my workspace** to replace it with your own information. No API keys are needed to explore it.

## Run locally

Requires **Node.js 24 or newer**. The application has **no third-party runtime dependencies** and no build step.

```bash
git clone https://github.com/Shriram-hub/fantastic-waffle.git
cd fantastic-waffle
# While the prototype pull request is open:
git checkout codex/orbit-prototype
npm start
```

Open **http://127.0.0.1:3000**. Data persists in `data/orbit.sqlite` across restarts. Keep this directory private and back it up if needed.

For optional integrations, copy `.env.example` to `.env` and restart. On macOS/Linux use `cp .env.example .env`; on PowerShell use `Copy-Item .env.example .env`. Keys stay on the server; the browser sees only connection booleans.

## Implemented workflows

| Workflow        | What works in v0.1                                                                                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile         | Save personal details, skills, target roles, location, work style, portfolio, and work-authorization notes.                                                                      |
| Résumé          | Upload PDF, DOCX, or TXT up to 5 MB. Review extracted text and detected email/skills before adding suggestions. Download the original.                                           |
| Discovery       | Remotive public feed; selected Greenhouse and Lever company boards; search/filter; manual jobs from other boards.                                                                |
| Recommendations | Explained keyword score: skills 60%, role-title terms 25%, location 5%, work style 10%. No score until you supply skills or roles.                                               |
| Preparation     | Select up to 50 jobs, prepare them together, download personalized text packets, and open employer forms.                                                                        |
| Tracker         | Board/list views; seven stages; notes and stage history; CSV export.                                                                                                             |
| Email updates   | Paste an email, choose its application, review a rule-based suggestion, and explicitly apply or dismiss it.                                                                      |
| Contacts        | Import up to 500 CSV rows with duplicate/error reporting; manual contacts; Apollo search; separate enrichment; suppression.                                                      |
| Outreach        | Create/edit campaigns for up to 100 recipients, personalize variables, attach the uploaded résumé, review every message, download unsent `.eml` drafts.                          |
| Sending         | Optional Resend adapter; separate enable switch, fresh preview, recipient-count approval, verified-address gating, suppression, per-recipient results, and duplicate protection. |

**Not implemented:** automatic employer-site submission; LinkedIn/Indeed/Naukri/Wellfound imports or scraping; mailbox scanning and Gmail/Outlook OAuth; scheduled campaigns; delivery/open tracking; multi-user accounts; production send queue. These are presented as planned or external-link workflows, never connected services.

## Five-minute walkthrough

1. Explore the overview, jobs, and tracker. All sample companies, vacancies, compensation, contacts, and activity are fictional.
2. Choose **Start my workspace**. Save your profile, upload a résumé, review detected details, and enter your interests.
3. In **Connections**, refresh Remotive or configure company board slugs for Greenhouse/Lever. Provider/network failures show an error and preserve existing data. You can always **Add a job** using a link found elsewhere.
4. In **Find jobs**, select opportunities and choose **Prepare applications**. Download a packet in the tracker. Open the employer form, apply there, then update the stage to **Applied**.
5. Import contacts or configure Apollo. In **Outreach**, select recipients, write your message, attach the résumé, and **Review campaign**. Download drafts without any email API configuration.
6. In **Email updates**, paste an interview invitation. The tracker changes only when you accept the suggestion.

## Résumé extraction

TXT and DOCX work out of the box. PDF extraction uses optional **Poppler `pdftotext`**. Install Poppler through your OS package manager or use the Docker image. Without it, the original PDF is saved and attachable; paste text in **Review extracted text**. Image-only PDFs need OCR, which is not included.

Extraction produces reviewable suggestions using a small skill dictionary, not a full résumé assessment. Enter additional skills manually. Ranking uses your saved profile; there is no hidden model inference or hiring-probability claim.

## Job sources

Remotive jobs retain source attribution and link to the original Remotive listing. Successful refreshes are cached for six hours. Do not run parallel instances to bypass refresh limits.

For Greenhouse/Lever, enter the company slug from its public board URL. These adapters cover selected company boards, not every employer using a provider. Ten boards per provider are supported. A posting missing from a later successful sync is hidden from discovery and retained for application history.

Other major boards have external search links. No API partnership or universal job-market coverage is implied.

## Apollo contacts

Set `APOLLO_API_KEY`. Search returns up to 25 people. Save selected results, then **Enrich** an individual contact to request a work email. **Enrichment may consume Apollo credits**; each lookup requires confirmation. Exact cost depends on your plan. Orbit does not request personal emails/phone numbers or guess missing addresses.

Contact CSV format:

```csv
name,email,company,title,email_status
Jamie Chen,jamie@company.example,Example Company,Talent Partner,unverified
```

Only `email` is required. `verified` is the only value that marks a provider-verified email. **CSV verification labels are user-supplied, not independently validated by Orbit.** Manual contacts default to unverified. Sample addresses are preview-only. Quoted commas/newlines, doubled quotes, CRLF, and UTF-8 BOM are supported.

## Enable real email sending

Only configure this when you intend to send real campaigns:

```dotenv
RESEND_API_KEY=your-key
EMAIL_FROM=you@your-verified-domain.com
ENABLE_LIVE_SEND=true
```

Use a plain sender address on a Resend-verified domain. Save your real name/email in the profile. Live sending requires verified, non-sample recipients, a fresh preview, and explicit approval of the recipient count. Each person receives a separate message, not a shared To/CC list.

Approval expires after ten minutes and is invalidated by profile, résumé, campaign, or contact changes. Messages include sender identity and an opt-out instruction. Use **Suppress** to record unsubscribe replies; automatic reply processing is not included.

The prototype paces requests and caps sending at **100 messages per UTC day**. `accepted` means the provider accepted a request, not confirmed inbox delivery. Ambiguous network/provider failures become `unknown` and are never automatically resent. Reconcile these in Resend. Durable sends require the queue/webhook milestone described in the architecture document.

## Verification

```bash
npm run check
npm test
```

Tests cover real HTTP routes, SQLite persistence, résumé parsing, CSV import, matching, adapter response shapes, previews and attachments, review invalidation, suppression, concurrent-send blocking, duplicate protection, crash recovery, and page rendering/escaping. Providers are mocked: tests never send email or consume Apollo credits.

A read-only smoke test also fetched the live Remotive feed successfully.

**Limit:** no real browser visual/interaction pass or credentialed provider smoke test was available in this environment. Automated template checks run in Node, not a browser. CI runs the syntax and test suite on Node 24.

## Docker

```bash
docker build -t orbit .
# Set a long, unique WORKSPACE_PASSWORD in .env first.
docker run --rm -p 127.0.0.1:3000:3000 --env-file .env -e HOST=0.0.0.0 -v orbit-data:/app/data orbit
```

Docker binds to `0.0.0.0` internally, so **WORKSPACE_PASSWORD is required**. Use `orbit` as the browser Basic Authentication username and your configured password. Poppler is included, and the volume preserves data.

For remote access, use an HTTPS reverse proxy, a strong workspace password, and an `ALLOWED_HOSTS` list. This is a **single-user, single-process prototype**, not a multi-user hosted service. Do not run multiple writable replicas against the same data or use Basic Authentication as a production account system.

## Project map

| Path                   | Purpose                                         |
| ---------------------- | ----------------------------------------------- |
| `public/`              | Responsive buildless interface.                 |
| `server/index.mjs`     | HTTP API, same-origin controls, static serving. |
| `server/domain.mjs`    | Matching, CSV, templates, application packets.  |
| `server/providers.mjs` | Job feeds, Apollo, and Resend adapters.         |
| `server/resume.mjs`    | TXT/DOCX/optional PDF extraction.               |
| `server/store.mjs`     | SQLite and interrupted-send recovery.           |
| `server/fixtures.mjs`  | Explicitly fictional sample workspace.          |
| `tests/`               | Node tests; no real campaigns.                  |

See [architecture and milestones](docs/ARCHITECTURE.md) and [API reference](docs/API.md).

## Primary API references

- [Remotive public API](https://github.com/remotive-com/remote-jobs-api)
- [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html)
- [Lever Postings API](https://github.com/lever/postings-api)
- [Apollo People Search](https://docs.apollo.io/reference/people-api-search) and [Enrichment](https://docs.apollo.io/reference/people-enrichment)
- [Resend Send Email](https://resend.com/docs/api-reference/emails/send-email)

The repository owner can choose the project license.
