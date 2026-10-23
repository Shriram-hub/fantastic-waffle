# Interview, mail and company workbenches

This upgrade uses the existing Render web service, supervised worker and private Supabase database. It needs no new database tables, paid subscription, voice service or API key. Existing provider credentials and sending preferences are preserved.

## Mock interview studio

- Open **Career & Interview Prep → Interview prep → Start mock interview**, or choose **Practice interview** on a job or tracker card.
- Pick a job or one of six tracks: finance / investment banking, accounting / audit / tax, consulting, software / AI, product management and behavioral.
- Questions and reference answers ship with the application. The four-part, 0–100 local rubric works without external calls. Scores are practice heuristics, not an employer assessment or predicted hiring result.
- Type an answer, or explicitly start the browser microphone. `SpeechRecognition` / `webkitSpeechRecognition` availability depends on the browser. Its recognition service may process audio remotely; offline voice is not guaranteed. Text practice always remains available. Question read-aloud uses browser speech synthesis.
- The two-minute timer uses an absolute deadline. Ending the timer stops voice input without automatically submitting an answer. Closing the session aborts recognition, cancels speech synthesis and cancels the pending evaluation request.
- Optional Gemini coaching requires the in-session consent checkbox. It uses the existing encrypted key and structured output adapter, with a 12-second deadline and complete local fallback. Source-selected excerpts must match saved professional evidence exactly; no invented achievements or numeric outcomes are added.
- A reference answer is editable and is saved to Story Bank only when the user clicks Save. Company briefs cite public sources and distinguish saved hiring signals from current news.

## One-screen mail studio

Open **Outreach & Sequences**. The advanced campaign editor remains available in the expandable section below the new studio.

1. Filter and select up to 100 recipients. Pasted CSV accepts `Name, Email, Company, Role` with or without a header. Pasted, inferred and publicly published addresses remain unverified until a verifier confirms the mailbox. An MX record confirms routing only.
2. Choose a preset, edit the subject and body, and insert merge tags. Both browser and server use `shared/mail-merge.mjs`; existing snake_case tags still work. Recipient previews interpolate the exact company and known job title, with no invented shared background.
3. Choose a connected Gmail / Outlook mailbox. Attach the master PDF or a current tailored PDF for the same company, add a recipient-specific tracked link, and optionally include a same-thread follow-up after four business days. A new tracked URL is created at explicit review, not on every keystroke.
4. **Review exact batch** shows every final subject, body, sender signature and tracked link. **Launch mass mail batch** approves that exact content and count. Changes require another review; review tokens expire after ten minutes.

Normal studio batches use 2–5 minute jitter within the existing configured business window. Explicit instant test batches support at most five verified recipients; daily account budgets still apply. “Send next email immediately” moves the next approved message to the next permitted account slot and does not erase account leases or daily caps. Sending progress distinguishes provider acceptance, queueing, explicit rejection and uncertain acceptance. Provider acceptance is not proof of inbox placement.

Duplicate launches reuse the existing outbox. Normalized email/job reservations cover studio general introductions as well as job-specific campaigns. Pause cancels pending sends and follow-ups. Retry releases only explicit provider rejections with unchanged approved content; timeouts and uncertain acceptance remain held for reconciliation. No real outreach was sent while validating this upgrade.

The inline **Auto-fetch up to 50 contacts from top jobs** action checks up to ten companies with five prospects each. This is a requested maximum, not guaranteed available or verified contacts. Optional people-search and email-provider credit toggles default off. Public-only discovery requires no API key. Hunter, Prospeo, Minelead and Tavily free quotas remain finite; GetProspect is optional.

## Company explorer and public discovery

Open **Company Explorer**, or its shortcuts in the Jobs Feed and Mail Studio.

- The curated catalogue contains 526 real employer references, with additional matches from the expanding employer registry. References are not a claim of current openings or of successful live validation.
- Search by company / industry, sector and observed city / directory region. Location filtering uses saved tags and observed job locations. “Global” does not assert that a company has offices everywhere. Unknown industries remain Other employers rather than being mislabeled.
- Explicit public lookup uses Clearbit autocomplete when available and Wikipedia / Wikidata, with bounded requests, caching and independent failure handling. Wikidata official-website claims supply domains where present. Ambiguous names remain selectable suggestions; unknown/private companies can return no result.
- Wikipedia excerpts link to their source and the CC BY-SA 4.0 license and are marked as shortened. No paid search API is necessary for this workflow.
- Background probes follow source-supported company career links and check supported public board formats. A guessed, same-named ATS slug is a review-only lead and is never automatically attributed to a company. Workday tenant names are learned from real career links, not fabricated from a corporate domain.
- **Fetch open jobs** runs in the worker, checks known boards, public career-page JobPosting data and available public LinkedIn results, and deduplicates into the disk-backed job catalogue. Up to five pages per company action are fetched; recurring discovery continues deeper supported pagination. Restricted or robot-blocked pages fail visibly without bypasses.
- **Find decision makers & mail** queues contact discovery and opens the mail studio filtered to that company. It never launches outreach automatically.

New zero-key sources: **Hacker News, Rippling, Pinpoint, BreezyHR, BambooHR and Personio**. Source parsers preserve missing descriptions/dates as missing. Hacker News reads the latest official monthly Who Is Hiring thread; published emails retain their public reference and remain unverified. Board adapters require a real public employer board; employer settings, closures and access restrictions can prevent retrieval.

Primary implementation references:

- [HN Algolia API](https://hn.algolia.com/api)
- [Pinpoint public postings JSON](https://developers.pinpointhq.com/docs/jobs-json-endpoint)
- [Personio XML integration](https://support.personio.de/hc/en-us/articles/360000314338-Overview-of-the-Personio-Recruiting-API)
- [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)

Existing employer directory attribution and licenses remain in `SCALED_DISCOVERY.md` and each board record.
