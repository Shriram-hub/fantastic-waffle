# Focused workspaces and outbound power tools

Veloce now has five sidebar entries and 18 addressable sub-views. Existing hash routes, APIs, providers, modals and review/send checks remain available. No database migration or new API key is required for these changes.

## Navigation and feature inventory

| Workspace | Sub-views | Existing tools retained |
| --- | --- | --- |
| Overview | Today; Activity & health | Four compact KPIs, priority actions, daily sprint, pipeline funnel and quick launch drawer, setup checklist, worker status, queue wake-up, automation timeline, extension download |
| Jobs & Companies | Job Feed; Company Explorer; Applications Pipeline | Preferences and source drawers, role/city/source/work-mode filters, recent-posting toggle, all five feed views, full-index paging, multi-selection, saved jobs, browser batch assistant, job detail, per-job outbound preparation, resume optimization, interview practice, company discovery, Kanban/table and manual stage changes |
| Outreach & Contacts | 1-Screen Mass Mailer; Find Contacts; Contacts Directory; Drip Sequences & Queue; Inbox & Replies | Exact per-recipient previews, presets/merge tags, paste/import/export, verification and evidence, tracked/tailored resume options, pacing/limits/pause/retry, company and bulk discovery modes, industry presets, LinkedIn extension launch, provider diagnostics, sequence builder, campaign editing/preview and delivery history, mailbox sync/pasted updates, tracker review and action links |
| Profile & Interview Prep | Master Profile Vault; Tailored Resumes & Cover Letters; Mock Interview Simulator; Story Bank & Career Planner | Structured profile sections and LinkedIn import, resume upload/extraction/download/share/revoke in a drawer, approved autofill answer bank drawer, search/outreach details, document editing/preview/download, interview guides and answer notes, automatic prep preferences, text/voice mock interviews, STAR stories, planner, analytics, weekly goals and calendar export |
| Settings & Autopilot | Mailbox & Sending; API Keys & Quotas; Autopilot Rules & Review; Alerts & Appearance | Google/Microsoft connect and mailbox checks, sending limits/time zone/inbox preferences, company board slugs, extension pairing/token lifecycle, workspace reset/seed controls, encrypted provider keys and quotas, autopilot rules/approvals/held lookups, automation timeline and both worker queues, alerts, branding/accent/theme and setup checklist |

Only the selected primary view is rendered. Auxiliary forms remain mounted inside hidden native dialogs so drafts survive closing a drawer. Dialogs support Escape, scrolling, focus return and mobile widths. Tabs support arrow keys, Home and End. All application tokens and component rules live in `web/src/styles.css`; the older React stylesheet paths are compatibility stubs. `public/styles.css` belongs to the separately retained legacy public application and is not imported by React.

## New workflows

### Writing checks and spintax

`shared/mail-merge.mjs` expands `{Hi|Hello|Hey}` before merge variables. A deterministic recipient/template seed keeps preview, retries and rendered messages consistent. Literal contact data is not interpreted as spintax. The mail studio offers safe greeting variations and draft tightening. Content checks count words/links and flag promotional wording; server previews include checks against the exact rendered message, including its footer. The score is a writing heuristic, not an inbox-placement guarantee or a replacement for account caps and mailbox verification.

### Replies and referrals

Incoming relevant messages carry interview/call, positive/referral, out-of-office, bounce or other categories. Rejections do not become positive replies merely because they thank the candidate. OOO parsing extracts explicit dates and literal alternate addresses from the newest message text. Referral records retain source evidence and **remain unverified**; another company's domain also requires review. Domain routing and mention in an email do not establish mailbox deliverability.

`POST /api/inbox/:id/draft-reply` creates an editable, ten-minute preview. Optional Gemini use requires an explicit choice; a local template remains available. Suggested weekday slots use the candidate's IANA time zone and do not claim to check calendar availability. `POST /api/inbox/:id/send-reply` requires approval of that exact preview. Recipients and mailbox identity come from the original message/account. Gmail thread IDs and RFC message references, or Outlook's reply-to-message operation, retain the conversation. The worker records uncertain acceptance and prevents automatic duplicate retries. Queued replies can be cancelled through Worker queues; cancelling or disconnecting the mailbox updates the reply state.

### Keyboard triage

`j`/`k` focus jobs or contacts; `p` prepares outbound for a focused job; `a` opens its application URL; `e` opens company contact discovery; `m` transfers selected contacts to the mailer; `?` opens help. Single-key actions pause in inputs, editable content and open dialogs. Cmd/Ctrl+K remains available.

### Daily sprint

`POST /api/workbench/daily-sprint` picks up to five distinct companies with eligible profile matches of at least 75%, source posting dates within 14 days and no queued/accepted/uncertain pitch. It checks both retained jobs and the current ranked catalog. Same-day/profile/preferences starts reuse the durable run, and each company uses the existing background pitch pipeline capped at three contacts. Credit-consuming search, verification and model use are separate opt-in options.

`GET /api/workbench/daily-sprint/:id` exposes preparation progress. The finalizer consolidates up to 15 factual per-role messages into the mail studio without sending. Contacts still need verified mailboxes, the selected connected account, an exact preview and launch approval. Combined drafts use the master resume's tracked link; individual tailored PDFs remain in each role's pitch/document view. Actual volume and preparation time depend on source coverage, verification and provider quotas. A stopped child task becomes an actionable failure rather than an indefinitely running sprint.

### Compensation and negotiation

`POST /api/career/negotiation-kit` filters indexed advertised-pay disclosures by supported role, location, currency and annual/monthly period. With at least five usable postings it interpolates the 25th, 50th, 75th and 90th percentiles of advertised range midpoints. Source URLs, pay basis, dates and sample size remain visible. This is an indexed-posting sample, not a population salary survey; currencies are not converted and separate bonus percentiles are unavailable when the sources do not disclose them. Fewer than five observations returns no percentile estimate. Email and phone scripts use an entered annual base target or the master profile's saved salary preference.

## Verification

- `npm test`: 292 passing tests, including original regressions, focused view/tab inventory, shortcuts, zero-emoji checks, spintax, exact writing checks, OOO extraction, reply approval/threading/cancellation/uncertain-send protection, sprint idempotency and salary evidence/validation.
- PostgreSQL-compatible tests verify referral persistence, reply cancellation and negotiation-kit persistence through the existing JSON-backed records; no new schema migration is needed.
- `npm run build` and `npm run check` pass. Compensation tools load as a separate on-demand chunk.
- Headless Chromium exercised all five workspaces, drawers/focus restoration, job shortcuts, company/bulk discovery separation, mail preview, inbox filtering and reply drafting, profile drawers, compensation, settings/queues, and a real five-company worker sprint producing 15 exact reviewed drafts. Desktop/mobile layouts and dark/light themes were inspected. QA used local fixture providers and sent no emails.
