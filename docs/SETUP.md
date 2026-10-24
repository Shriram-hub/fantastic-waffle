# Provider setup and verification

## Workspace identity

The running version is a personal workspace. Keep the default loopback binding, or configure a strong `WORKSPACE_PASSWORD` and HTTPS reverse proxy. The Basic Authentication username can be `orbit`. `ALLOWED_HOSTS` can restrict accepted request hosts. Mailbox OAuth connects an account inside that workspace; separate SaaS account registration/tenant isolation is not implemented.

Generate an encryption key before connecting a mailbox:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Set the output as `TOKEN_ENCRYPTION_KEY`. Losing/changing it makes stored mailbox credentials unreadable; reconnect those accounts. Do not commit `.env`.

## Google / Gmail

1. Create a Google Cloud OAuth web client, enable the Gmail API, and configure its consent screen/test users as appropriate for your application.
2. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `PUBLIC_BASE_URL`.
3. Register the exact redirect URI: `<PUBLIC_BASE_URL>/api/oauth/google/callback`. Local default: `http://127.0.0.1:3000/api/oauth/google/callback`.
4. The implementation requests `gmail.readonly` and `gmail.send`, uses PKCE and single-use state, and requires offline access for refresh tokens. It reads the connected mailbox profile to identify the account.
5. In Orbit, connect Google, then queue a manual Sync. Verify that relevant updates enter review before enabling automatic stage changes.
6. For push, configure a Pub/Sub topic, grant Gmail’s push publisher access to it, and set `GOOGLE_PUBSUB_TOPIC`. Configure an authenticated push subscription to `<PUBLIC_BASE_URL>/api/webhooks/gmail` with a service-account OIDC identity.
7. Set `GOOGLE_PUBSUB_AUDIENCE` to that configured audience and `GOOGLE_PUBSUB_SERVICE_ACCOUNT` to the exact expected service-account email. The handler checks signature, issuer, audience, email, and email verification before reading the event.
8. Queue Enable push watch. The worker stores the expiry and schedules renewal. Notifications trigger incremental history sync, not immediate guessed status changes.

Provider review/verification and quota requirements depend on how the Google app is distributed. No Google project, Pub/Sub subscription, or production OAuth approval is created by this repository.

Primary references: [Gmail push](https://developers.google.com/workspace/gmail/api/guides/push), [history sync](https://developers.google.com/workspace/gmail/api/guides/sync), [thread management](https://developers.google.com/workspace/gmail/api/guides/threads).

## Microsoft / Outlook

1. Register an app in Microsoft Entra with the intended supported account types and a web callback `<PUBLIC_BASE_URL>/api/oauth/microsoft/callback`.
2. Set `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET`.
3. Delegated scopes are `offline_access`, `User.Read`, `Mail.Read`, `Mail.Send`, and `Mail.ReadWrite`. ReadWrite is used to create/send reply drafts for threaded follow-ups; it is not required by a read-only application design but is required by this implementation’s draft workflow.
4. Connect the mailbox, queue a Sync, and validate delta paging with your test account.
5. Graph webhooks require a reachable public HTTPS base URL. Queue Enable push watch. The endpoint echoes the validation token as plain text and authenticates subsequent notifications using the stored subscription ID and unpredictable clientState.
6. Confirm subscription renewal and missed/subscription lifecycle behavior in a real environment before relying on autonomous operation.

Primary references: [Graph notifications](https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks), [delta messages](https://learn.microsoft.com/en-us/graph/delta-query-messages), [reply drafts](https://learn.microsoft.com/en-us/graph/api/message-createreply?view=graph-rest-1.0).

## Contacts and verification

Apollo uses `/api/v1/mixed_people/api_search` and selected `/api/v1/people/match` lookups, not the older people-search endpoint in the brief. Search results with masked names/emails are never treated as sendable addresses. Company-size targeting uses an explicitly supplied size: founder/leadership roles for fewer than 50 employees, recruiting/management roles otherwise. You can edit the titles.

Hunter verification is separately confirmed and queued. A valid/deliverable result is sendable only if it is not accept-all. Invalid, catch-all, and unknown results stay blocked. Verification is a provider signal, not a promise of reply or delivery.

Primary references: [Apollo search](https://docs.apollo.io/reference/people-api-search), [enrichment](https://docs.apollo.io/reference/people-enrichment), [Hunter verification](https://hunter.io/api-documentation/v2#email-verifier).

## Models and embeddings

Use an OpenAI-compatible HTTPS endpoint, API key, and explicitly selected model. There is no hardcoded model version or assumed plan access. Structured output requires the configured provider/model to accept JSON-schema response formatting; incompatible responses fail visibly. Embedding requests require a separate explicit `EMBEDDING_MODEL` value. Cosine vectors must have equal, finite dimensions.

Structured extraction, personalization and matching are confirmed operations. Model-based email classification is a separate opt-in setting because it sends matching email text to that provider. Exact-source quote checks reduce unsupported extraction/personalization; human review remains necessary.

## S3 / R2

Configure a private bucket and server-side credentials with only the needed object access. R2 uses an S3-compatible endpoint and typically region `auto`; AWS S3 should use the actual bucket region. The worker writes `resumes/<content-hash>` objects and removes original bytes from the active résumé row after persistence. Downloads hydrate through authenticated application routes; no public bucket URL or ACL is required. Test upload/download/integrity before enabling real users.

## Sending

Set `ENABLE_LIVE_SEND=true` only for an intended sender test. Native mail uses the connected account. Resend requires a verified-domain plain `EMAIL_FROM` and API key. Begin with an owned test recipient and verify the attachment/link, sender, reply threading, pause, suppression, ambiguous-outcome handling, and received reply before a real campaign.

Sending is limited/paced by policy. The app makes no claim that personal OAuth sending guarantees primary-tab delivery, that attachments always trigger filtering, or that a particular volume will suspend an account within a fixed time.

## Verification limits

Local automated tests use mocked provider responses; no real email was sent and no paid enrichment/model call was executed. Real separate SQLite worker processing and a PostgreSQL-compatible runtime are tested. Chrome UI/form interaction, credentialed provider acceptance, Redis/Docker deployment, and the optional PostgreSQL export still need environment-specific validation. Do not interpret a configured key or compiled adapter as a verified production integration.
