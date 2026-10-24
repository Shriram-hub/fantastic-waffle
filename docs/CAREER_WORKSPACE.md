# Career workspace additions

The app continues to run on Render with the private Supabase PostgreSQL runtime. No Vercel, Neon, new paid worker, or new database service is required.

## Discover jobs in India and finance

In **Discover jobs → Edit preferences → Choose discovery sources**, enable **India & finance boards** and select country `IN`. Save your target roles, cities and experience level. The two-hour discovery sweep includes search-index results for Naukri, Instahyre, eFinancialCareers, IIMJobs, Internshala and Wellfound.

This source uses the existing `SERPAPI_API_KEY`. These portals do not expose a documented unrestricted, zero-key search feed. Orbit does not bypass their sign-in pages, robot restrictions, CAPTCHA, or private APIs. The UI labels snippet-only leads; open the source to confirm requirements and whether applications are still accepted. A missing company is never inferred from a domain or query. Existing zero-key ATS and public feeds continue independently.

Regional search and Google Jobs share `JOB_SEARCH_API_DAILY_LIMIT` (default 6, server maximum 30). Cached results do not spend another request. Google role/location priority rotates by day so one role cannot consume the entire budget forever. Source health reports missing keys, unavailable sources, and exhausted budgets.

## Alumni and past-company contacts

Fill education and employment in **My profile → Candidate vault**. In **Contacts → Contact discovery**, enable the optional shared-background search. Autopilot uses the same prioritizer when its search API option is enabled.

One cached SerpApi X-ray search per company looks for matching school/employer names in public profile snippets. An explicit education or former-employer statement is marked **source supported**; keyword co-occurrence is **possible** and is never used as an email hook. The source and supporting text are shown in Contacts. A shared background does not establish a personal relationship.

Hunter Email Finder can look up a named warm prospect when contact credits are allowed. Missing addresses remain empty. MX records alone never make an address sendable. Only verified corporate addresses enter the sending pipeline. Warm searches share the optional search budget; email finding and verification share `CONTACT_API_DAILY_LIMIT`.

## Tailored PDFs

Open a job and choose **Generate résumé & cover letter**. Documents use your original work bullets, education, projects and STAR examples. The optional Gemini mode selects existing evidence IDs rather than inventing new achievements. Bundled Latin, Greek, Cyrillic and Devanagari fonts preserve currency symbols and Indian names; unsupported scripts fail explicitly so missing glyphs cannot silently remove text. Decorative emoji are omitted from PDFs. The résumé has a single-column selectable text layer; the cover letter targets roughly 250 words, with the actual count displayed. Review both PDFs.

The files are stored privately using the existing résumé object storage. A changed job/profile produces a new document fingerprint. Earlier snapshots remain downloadable, while campaign creation requires current documents. Campaign-linked and active public-link documents are retained.

In **Outreach**, choose the related job, generate/select the files, and choose résumé and/or cover-letter attachments. Tailored files must belong to that campaign's company. Autopilot prepares job-specific documents itself; browser-assisted applications prepare both PDFs and upload each only to its matching labeled input. Existing user-uploaded files and manually entered form answers are preserved.

## Email sequences

The outreach sequence editor supports up to three reviewed follow-ups. Defaults are **4 and 8 business days after the first email**, with ascending offsets up to 30 business days. Existing one-step campaigns remain supported. Review every step in Campaign Preview before approving.

Gmail/Outlook follow-ups reuse the provider thread plus RFC `In-Reply-To` and `References`. Each campaign/address/step has its own unique send reservation. A failed or unknown preceding step blocks later steps. Follow-ups do not repeat attachments. A detected recipient reply cancels all pending follow-ups for the company, including replies in a new thread. Suppression, unsubscribe, pause, changed approved content, and stale inbox sync also stop the sequence.

`ENABLE_LIVE_SEND` remains an explicit server setting. This release does not turn it on or send any campaigns. Resend supports multiple initial attachments and unsubscribe/thread headers; automated follow-ups require a connected mailbox for reply detection.

## Copilot and batches

Download the updated extension in **Connections**, unpack it, and reload/install **version 0.7.0** in Chrome. Pair it again with a fresh Orbit token. The floating copilot appears on supported application pages and shows the saved job match, checked keywords not found in your profile, and discovered hiring contacts. Keyword gaps are review prompts; do not add unsupported skills.

Select up to ten jobs and choose **Apply with copilot**. After confirming, the paired extension opens one application at a time, fills recognized fields and documents, and waits for your review and manual submission. It advances only after a matching ATS success message follows a recent submission attempt. Pause, resume and skip controls are available in the copilot/popup. Skipping never marks a job Applied.

The extension uses native input setters, open Shadow DOMs and permitted iframe traversal. Embedded ATS confirmation origins must have been observed on the queued application page. Closed shadow roots, portal redesigns, custom controls, unknown eligibility questions, origin-changing redirects and CAPTCHA can require manual work or permission. This is assisted application filling, with no CAPTCHA bypass or automatic final submit.

## Résumé activity

Choose **Use a recipient-specific résumé link** in Outreach. Each link expires after 30 days and can be revoked in the existing résumé vault. It serves the selected tailored résumé when available. Contacts and Overview show timestamped activity. Known scanners/prefetches do not create a hot-lead signal; repeated requests within 30 minutes are grouped.

**A request is not proof of a human view.** Email security scanners sometimes use ordinary browser user agents. Orbit reports link activity, not confirmed reads, and does not store requester IP addresses.

## Phone alerts: optional credentials

Configure **Connections → Phone alerts**. No new environment keys are needed for discovery, documents, sequences or interview kits when SerpApi, Hunter and Gemini are already configured.

| Channel | Enter in Connections | Additional setup |
| --- | --- | --- |
| Telegram | Bot token, your numeric chat ID | Create a bot with BotFather, start your own bot chat, obtain its chat ID. |
| Discord | Your channel's webhook URL | Create a webhook in channel Integrations settings. Only `discord.com` webhook URLs are accepted; mentions are disabled. |
| WhatsApp | Cloud API token, business phone-number ID, your phone digits, approved template name and language | Meta WhatsApp Business setup and an approved template with **one text body variable**. Provider fees can apply. `WHATSAPP_GRAPH_VERSION` optionally overrides the default `v23.0`. |

Destination credentials are AES-256-GCM encrypted using the existing `TOKEN_ENCRYPTION_KEY`. They are never returned by the API. Select events, confirm the destination is yours, and enable alerts. Saving does not send a test message. Disabling/changing the destination invalidates queued sends for the previous configuration. Unknown acceptance is held instead of automatically retried.

Alerts fire when the worker processes a uniquely matched interview/assessment update or an eligible résumé-link request. Gmail/Graph push notifications give the fastest ingestion when configured. The existing 15-minute mailbox polling and cloud wake scheduler remain fallbacks; free Render sleeping and provider delays prevent an always-instant guarantee.

## Automatic interview kits

A uniquely matched, timely interview email creates a company/role guide and planner action. Ambiguous or terminal applications do not trigger a kit. Retries and repeated mailbox syncs do not duplicate the action. Finance roles include financial-statement, forecasting/valuation and reconciliation practice; questions show relevant saved STAR stories without filling in invented answers.

Free role-based automatic prep is enabled by default. In **Planner & interview prep**, disable it or explicitly opt in to Gemini for future guides. AI mode uses the existing `LLM_API_KEY`, `LLM_MODEL` and Gemini configuration. Assessment deadlines become planner due dates only when an exact timestamp and timezone are present; otherwise review the email and set the date yourself.

## Verification

Run `npm ci`, `npm run check`, `npm run build`, and `npm test`. Regression coverage includes indexed source parsing, shared-background evidence, PDF text extraction and stale-source checks, two business-day follow-ups and threading, company reply cancellation, separate document inputs, sequential batch confirmation, encrypted alerts, scanner-aware links, private APIs and automatic interview kits. Browser/ATS behavior remains subject to real portal markup and user permissions.
