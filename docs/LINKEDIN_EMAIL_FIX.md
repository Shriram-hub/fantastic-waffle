# LinkedIn email finder 0.13.0

The previous release could miss profile navigation from LinkedIn's feed because the content script only matched profile/company URLs at document creation. Profile extraction also relied on a narrow employer selector, and returned no email to the drawer until its queued worker completed.

## Extension changes

- The manifest now loads classic `linkedin.js` and `contact-ui.js` scripts on LinkedIn, including its feed, so in-page profile navigation is detected. The existing module entry `linkedin.mjs` is a thin adapter for the module service worker and Node tests. It is never listed as a classic content script. No dynamic evaluation or remotely hosted code is used.
- Profile parsing supports the visible heading, adjacent headline, aria-only current-employer controls, company anchors and current experience. Bounded parsing of profile objects already embedded in the page is a fallback and is matched to the current profile slug. The synchronous parser only reads page content. On an explicit lookup, a separate bounded reader can request contact info and the linked company website from the same signed-in LinkedIn tab.
- Company/search harvests use profile anchors, current card containers and source-supported embedded profile data. Names are cleaned of accessibility text, pronouns and degree badges. Search imports stay company-filtered. Window and scrollable-main collection preserve the original scroll position and emit live scan counts.
- The floating drawer displays editable detected company/domain fields, a named Get Email button and up to 100 saved results. An isolated **Get Email (Veloce)** pill is inserted beside profile actions and is repaired after DOM or URL changes.
- Copy Email, Copy Found Emails, CSV download and Queue Pitch / Open in Mass Mailer are available. Opening the mail studio transfers selected saved contact IDs; it does not authorize sending. Existing verification, duplicate and exact-message approval checks remain active.
- The popup uses the same contact UI. Closing a popup does not cancel work already queued on the server.

## API and verification

`POST /api/contacts/import-browser-profiles` now returns initial saved contacts, primary suggestions, alternate suggestions and domain health in its first response. Verification continues through the durable worker and token-scoped status endpoint. Browser imports are prioritized after urgent alerts. A busy worker no longer causes a blank result drawer.

Company lookup and MX checking are bounded. Existing verified contacts retain their verification; a new employer is treated as a separate company-specific contact. Catch-all, invalid and inferred recipients remain excluded from live sending. Alternate verification runs only through the configured mailbox verifier, under the shared provider budget. A positive mailbox result can promote an alternate and supply naming-pattern evidence for future lookups; it does not prove every employee uses that format.

The Microsoft `GetCredentialType` sign-in endpoint is not used as mailbox verification. An account-existence or federation response does not demonstrate that an SMTP recipient is deliverable. No login enumeration, random-account probes or Port 25 connection is needed. The supported mailbox providers use HTTPS.

Optional public email-format search distinguishes explicit published claims, compatible masked examples and actual publicly observed addresses. For example, `j***` is ambiguous and cannot establish a full naming rule. Masks and search claims never mark a mailbox verified. Search and verification credit controls default off.

## Launching from the app

Company Explorer and Contact Discovery offer **Harvest on LinkedIn (Extension)**. An authenticated request creates a short-lived, company-bound launch intent in the LinkedIn URL fragment. The paired extension validates it before automatically collecting profiles. Arbitrary public URL fragments only open the drawer; they do not silently authorize a harvest or spend provider credits. Completed saves emit contact activity through the existing SSE channel.

## Bounce recovery

A hard recipient-address DSN must match a recently accepted outbox recipient before it changes contact status. It stops follow-ups, marks that address invalid and creates a review item. Mailbox-full and policy rejections are not treated as nonexistent recipients.

Alternative suggestions are retained. **Verify alternate and save** uses configured verifier credits; only an explicit verified result replaces the primary address. A fresh reviewed mail batch is required to send to that new address. Guessing an alternate never automatically causes another email to be sent.

## Installing the fix

Download the complete updated package from **Connections**. Replace the old unpacked folder, reload it at `chrome://extensions`, and refresh LinkedIn. The package includes the two new classic-script files, so replacing only the manifest or service-worker file is insufficient. Re-pair through Connections if the session expired.

Tests cover classic-script execution, three LinkedIn layouts and hydration fallback, immediate API results, alternate verification, bounded credit use, signed launch intents, bounce review and selected-contact handoff. Browser checks exercise feed-to-profile navigation and the inline button through the actual API using an isolated test world. This environment's headless renderer cannot install Manifest V3 extensions; native service-worker registration and an authenticated live LinkedIn account were not exercised here. No real outreach was sent during validation.


### Profile-loading correction (0.11.2)

Get Email now installs the bundled reader in the current tab's isolated world before extraction, returns extraction errors explicitly instead of losing them in Chrome's InjectionResult, and retries a loading profile for up to two seconds. The reader supports h2 and ARIA headings as well as h1. Metadata fallback requires a canonical URL matching the active profile so stale SPA metadata cannot identify another person. The download and pairing labels read the manifest version.

Validation includes redesigned profile fixtures, delayed rendering, Chrome injection errors, all existing tests and the Vite build. These fixtures do not establish compatibility with every signed-in LinkedIn layout.


## Exact-address resolution (0.12.0)

- The reader captures an email published in the active profile About/contact overlay or returned by its contact-info request. It reads only the requested profile and discards phone fields. Same-origin cookie/CSRF authentication stays in the isolated browser tab. Cookies, CSRF values and raw API responses are never forwarded to Veloce. Calls have deadlines, reject redirects and stop on denied requests.
- The linked organization Website field takes precedence over company-name-derived hostname suggestions. JSON is bound to the company slug/URN. The HTML fallback reads the Website field on that company's About page, not arbitrary external links. A corporate website hostname still does not prove the employee's mailbox or that every business unit uses that mail domain.
- With the relevant credit controls enabled, the worker searches the exact full name plus corporate domain, then uses the Hunter named email finder, Prospeo person enrichment and GetProspect finder before generating candidates. Published literal addresses keep their source URL. Ambiguous masks and conflicting literal addresses cannot become an exact result. Provider calls retain the existing encrypted keys, durable credit reservations, cache and shared daily caps. No new API key is required. GetProspect remains optional.
- Published address evidence is distinct from current mailbox verification. Only explicit valid mailbox results get the verified status. A direct LinkedIn/public address can be authentic source evidence and still be outdated or undeliverable. Fixed 92–100 percent accuracy claims are not displayed.
- If no source-backed address is found, the drawer and workspace show **No exact email found**, followed by two company-pattern or three common-name candidates. Candidate addresses have separate copy controls and are excluded from Copy Found Emails. Inferred, catch-all and invalid recipients remain blocked from sending.
- Search and finder credit switches remain off until selected. The options are expanded for an individual profile. Explicit bulk actions can enrich missing data per profile, with bounded concurrency, caching and a page deadline; opening the drawer alone does not start the bulk reads.
- Microsoft login account checks and Gravatar existence checks are not implemented as mailbox verification. Neither establishes current email deliverability or the claimed person's ownership. Public GitHub commit evidence elsewhere in discovery continues to remain unverified.

Primary provider references checked for this change: [Hunter Email Finder](https://hunter.io/api-documentation), [Prospeo Enrich Person](https://prospeo.io/api-docs/enrich-person). Prospeo's current endpoint is `/enrich-person`, rather than the older `/email-finder`; mobile enrichment remains off. Voyager is an undocumented browser endpoint, so a denial, changed response or missing readable CSRF token leaves it unavailable and the finder continues with other evidence. Official LinkedIn member APIs do not provide general third-party contact lookup through ordinary sign-in scopes: [LinkedIn permissions](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access).

Validation uses synthetic LinkedIn pages and contact-info/company payloads in a real isolated browser world, the actual local bearer API and persistence, with all existing tests and the production build. It does not establish live compatibility or accuracy for every signed-in profile. No live provider credits or outreach were used for QA.


## Automatic employer resolution (0.13.0)

The profile button is **Get Email** and the people-page button is **Extract Emails from Page**. Company/domain fields are optional inside a collapsed **Advanced Override**. There is no company-name gate in the background script, owner API, paired extension API, or worker. A profile can be saved with neither a company nor a domain.

On a user-triggered extraction, missing profile fields are enriched from LinkedIn profile/position data and available contact info. Profile hydration is bound to that person's public identifier/URN. Active position selection follows only related position entities and excludes ended positions. Related organizations provide their website or company slug for a bounded company-website lookup; profile HTML code hydration is the fallback. Summary text can supply a source-backed email but cannot make it mailbox verified. Session authentication stays inside the browser. Access/rate rejections pause the corresponding reads, and unresolved entries continue to backend enrichment.

At most three profile lookups run concurrently, under a page deadline. A shared company cache avoids repeating the same organization lookup. Each person retains an employer/domain independently, including different companies on one results page or employers sharing a mail domain. A direct address appearing on multiple profiles is held as ambiguous rather than assigned to each person.

For domain-free profiles, optional provider enrichment first uses Prospeo's current `/enrich-person` API with `data.linkedin_url`, then Apollo's current `/api/v1/people/match` URL match. Mobile/personal-email reveal and Apollo waterfall options stay off. Only an explicit valid mailbox result qualifies as verified. Wrong-profile matches are rejected. Apollo remains optional and account eligibility/access failures fall through to the other configured methods. The old Prospeo `/social-url-enrichment` documentation redirects to the current API; it is not called.

Optional indexed-profile search binds results to the exact LinkedIn URL, extracts an employer from that result and resolves the domain before name/domain email finding. Same-name results at another URL cannot supply an employer. Role-only search keywords are never treated as company names. An unknown person in mixed search results cannot inherit another result’s detected employer. Existing credit consent, daily budgets, request reservations and cache remain active. No new provider or infrastructure account is required.

When no source/provider returns enough information, the result is saved as unresolved with no fabricated employer or email. Automatic operation removes manual data entry; it cannot guarantee that LinkedIn or an external provider exposes every contact. Native MV3 registration and a live signed-in LinkedIn session remain outside this test environment.

Validation covers blank-company cards, active/past/unrelated positions, HTML hydration, mixed employers, shared-domain employer names, URL-only Prospeo/Apollo and indexed-profile fallback, the paired API through the actual worker, and optional/collapsed overrides. The isolated-browser check exercises a profile and fifty search cards with no visible company names through the real local API, without typing a company or sending an email.
