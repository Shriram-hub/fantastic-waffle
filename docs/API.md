# HTTP API reference

All routes are same-origin. Writes accept `application/json`; errors return JSON and an HTTP status. Configured workspace Basic Authentication protects all routes and static assets. State responses exclude provider secrets and raw résumé bytes.

| Method | Path                                     | Input / result                                                                                                |
| ------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| GET    | `/api/health`                            | Version and liveness.                                                                                         |
| GET    | `/api/state`                             | Workspace, computed matches, résumé metadata/text; excludes bytes and preview snapshots.                      |
| GET    | `/api/integrations`                      | Adapter/key configuration booleans.                                                                           |
| POST   | `/api/workspace/reset`                   | `{confirm: "START_FRESH"}` or `{confirm: "LOAD_DEMO"}`.                                                       |
| PUT    | `/api/profile`                           | Name, email, phone, headline, location, portfolio, authorization, summary, skills/interests arrays, workMode. |
| POST   | `/api/resume`                            | `{name, base64}`; stores file; returns extracted text and suggestions.                                        |
| PUT    | `/api/resume/text`                       | `{text}`; replaces extracted text.                                                                            |
| DELETE | `/api/resume`                            | `{}`; removes file and text.                                                                                  |
| GET    | `/api/resume/download`                   | Original file download.                                                                                       |
| PUT    | `/api/settings`                          | `{greenhouseBoards: [], leverBoards: []}`; ten slugs each maximum.                                            |
| POST   | `/api/jobs/manual`                       | Title, company, URL; optional location/workMode/salary/description.                                           |
| POST   | `/api/jobs/sync`                         | `{source: "Remotive"}` or `{source: "Greenhouse"                                                              | "Lever", board}`. Save company slugs first. |
| POST   | `/api/applications`                      | `{jobId, stage?, notes?}`; returns existing record instead of duplicating.                                    |
| POST   | `/api/applications/batch`                | `{jobIds: []}`; prepare 1–50 jobs without submitting.                                                         |
| PATCH  | `/api/applications/:id`                  | `{stage?, notes?}`.                                                                                           |
| GET    | `/api/applications/:id/packet`           | Plain-text application packet.                                                                                |
| GET    | `/api/export/applications`               | CSV tracker export.                                                                                           |
| POST   | `/api/contacts/import`                   | `{csv}`; 500 rows maximum, with per-row import/error reporting.                                               |
| POST   | `/api/contacts`                          | Name, email, company, title; defaults to unverified.                                                          |
| PATCH  | `/api/contacts/:id`                      | `{suppressed: boolean}`.                                                                                      |
| POST   | `/api/contacts/apollo/search`            | `{domain?, titles?}`; up to 25 people.                                                                        |
| POST   | `/api/contacts/apollo/save`              | `{ids: []}` from a search within 15 minutes.                                                                  |
| POST   | `/api/contacts/:id/enrich`               | `{confirmCredits: true}`.                                                                                     |
| POST   | `/api/campaigns`                         | Name, subject, body, contactIds, attachResume; creates draft.                                                 |
| PATCH  | `/api/campaigns/:id`                     | Same fields; only before delivery attempts.                                                                   |
| POST   | `/api/campaigns/:id/preview`             | `{}`; personalized messages, exclusions, attachment metadata, previewId.                                      |
| GET    | `/api/campaigns/:id/messages/:contactId` | Unsent `.eml` with actual attachment bytes. Never sends.                                                      |
| POST   | `/api/campaigns/:id/send`                | `{previewId, approved: true, confirmCount}`; configured/enabled sending and a current preview are required.   |
| POST   | `/api/inbox/analyze`                     | `{applicationId, from?, subject, body}`; creates suggestion only.                                             |
| POST   | `/api/inbox/:id/accept`                  | `{}`; applies a suggestion exactly once.                                                                      |
| POST   | `/api/inbox/:id/dismiss`                 | `{}`; dismisses exactly once.                                                                                 |

Stages: Saved, Ready, Applied, Interview, Offer, Rejected, Withdrawn. Work modes: Any (profile only), Remote, Hybrid, On-site.

Variables: `{{first_name}}`, `{{name}}`, `{{company}}`, `{{title}}`, `{{my_name}}`, `{{my_role}}`, `{{skills}}`, `{{portfolio}}`. Unknown variables and subject newlines block preview. Suppressed, missing, or duplicate emails are excluded and reported. Live sending additionally rejects sample/unverified addresses. Provider acceptance is not delivery confirmation.
