# Deep contact discovery and LinkedIn email finder

This release stays on the existing Render web service, supervised worker and private Supabase database. No new schema, paid service or API key is required.

## Company discovery

Open **Contact Discovery**, choose company names, corporate domains or your matching feed, then pick **Fast 15**, **Standard 35**, **Deep 50** or **Maximum 100** profiles per company. Existing low-volume API payloads remain supported.

Four title clusters cover executives, functional management, recruiters and senior specialists. Explicit reporting lines from a job remain prioritized. Serper pages request up to 50 results, Brave uses 20 results and zero-based page offsets, and DuckDuckGo Lite follows returned next-page form fields. Yahoo remains a public fallback. Pages stop at the requested volume, exhaustion, repeated results, the five-page cap or the time budget. Canonical LinkedIn URLs and normalized full names remove duplicates. Current employment still needs source review.

Search is queued immediately; deeper crawling does not hold the web request open. Background runs allow bounded pagination rather than trying to complete all searches in five seconds. The separate domain MX phase shares one lookup per domain, uses Google DNS over HTTPS and processes at most twenty domains concurrently with a 3.8-second deadline per batch. Actual mailbox verification takes provider requests and can take longer.

Industry buttons queue ten firms concurrently with a combined target of 100 profiles. The Mumbai / Delhi and India terms are search filters, not proof that each returned person is in that location. Sector presets are curated examples, not a current investment or valuation ranking. Results show profiles found, verified mailboxes and per-company progress separately.

Use the table filters and selection boxes, then **Send to Mass Mailer**. The selected IDs transfer without queueing messages. Unverified, invalid, catch-all, suppressed or unreviewed-domain recipients remain blocked by the existing mail studio. The normal exact-preview and send approval still apply.

## LinkedIn extension 0.10.0

1. In **Connections**, download the updated Chrome extension package. Replace the previous unpacked extension folder, reload it at `chrome://extensions`, and refresh your LinkedIn tab. Pair through the existing workspace flow if the session expired.
2. Open an individual's LinkedIn profile. The floating **Veloce · Get email** button opens the contact finder. **Get email** reads that person's visible header and current company, then queues a lookup into your contact ledger. It does not replace your own candidate profile.
3. If LinkedIn does not expose the employer, enter the current company manually. An optional domain can be supplied; confirm its official-company association before it becomes eligible for outreach.
4. On a company People page, use **Harvest 50–100 Employees from Page**. The script collects rendered cards during a bounded four-second scroll and restores the original position. It accumulates virtualized cards and stops at 100. Fewer loaded cards produce fewer results.
5. For people search, enter a company and filter LinkedIn to that employer. Only visible cards mentioning that company are imported. Open profiles individually if a card lacks employer evidence.
6. The popup exposes the same actions. Results can appear directly in the floating panel or popup; longer lookups continue in **Contacts** after the popup closes.

The extension uses the user's open tab and existing capability-scoped pairing token. It does not call LinkedIn's private APIs, navigate employee profiles automatically, bypass verification challenges, send connection requests or send outreach.

## Email evidence and free quotas

- **Pattern Match** means an inferred address based on the company's observed/provider-reported convention, or a clearly labeled common-name suggestion. Naming confidence is not a delivery probability.
- **MX Verified** means the company domain has mail routing. It does not establish that any particular inbox exists.
- **Hunter / Prospeo Direct** is shown only for an explicit mailbox-verified provider result. Invalid and catch-all results retain their status.
- Inferred addresses never become naming-pattern evidence unless mailbox verification succeeds. Ambiguous naming collisions remain held without a guessed deliverable address.
- Public search and browser harvesting need no key. Optional search and email-finder credit checkboxes default off. Each provider page and lookup retains its durable reservation and shared daily budget; a larger volume selector does not increase those caps.
- Fifty to one hundred is a collection target, not a guarantee of that many verified mailboxes. Search indexing, rendered LinkedIn cards, company size, provider access and finite free credits determine actual coverage. No address is fabricated to fill a quota.

Verification includes multi-page 100-profile fixtures, four-way query concurrency, daily-budget exhaustion, browser-action-to-API-to-worker polling, a 60-profile PostgreSQL import/reconnect, virtualized DOM cards, exact recipient selection transfer and mobile layouts. No real outreach is sent during validation.

Primary references:

- https://api-dashboard.search.brave.com/app/documentation/web-search/query
- https://developer.chrome.com/docs/extensions/reference/api/scripting
- https://developers.google.com/speed/public-dns/docs/doh/json
