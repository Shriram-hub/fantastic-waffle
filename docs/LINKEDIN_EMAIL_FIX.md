# LinkedIn email finder 0.11.0

The previous release could miss profile navigation from LinkedIn's feed because the content script only matched profile/company URLs at document creation. Profile extraction also relied on a narrow employer selector, and returned no email to the drawer until its queued worker completed.

## Extension changes

- The manifest now loads classic `linkedin.js` and `contact-ui.js` scripts on LinkedIn, including its feed, so in-page profile navigation is detected. The existing module entry `linkedin.mjs` is a thin adapter for the module service worker and Node tests. It is never listed as a classic content script. No dynamic evaluation or remotely hosted code is used.
- Profile parsing supports the visible heading, adjacent headline, aria-only current-employer controls, company anchors and current experience. Bounded parsing of profile objects already embedded in the page is a fallback and is matched to the current profile slug. It never requests private Voyager endpoints.
- Company/search harvests use profile anchors, current card containers and source-supported embedded profile data. Names are cleaned of accessibility text, pronouns and degree badges. Search imports stay company-filtered. Window and scrollable-main collection preserve the original scroll position and emit live scan counts.
- The floating drawer displays editable detected company/domain fields, a named Get Email button and up to 100 saved results. An isolated **Get Email (Veloce)** pill is inserted beside profile actions and is repaired after DOM or URL changes.
- Copy Email, Copy All Emails, CSV download and Queue Pitch / Open in Mass Mailer are available. Opening the mail studio transfers selected saved contact IDs; it does not authorize sending. Existing verification, duplicate and exact-message approval checks remain active.
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
