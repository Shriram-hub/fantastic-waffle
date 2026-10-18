# Orbit v0.2 API

Writes accept same-origin JSON and owner authentication. API responses never return OAuth secrets/provider keys. Public webhook and extension routes have their own authentication; résumé share links are explicit unlisted grants. Queued operations return **202 with a task**, not a fabricated immediate result.

| Method        | Path                                     | Behavior                                                                                                                           |
| ------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| GET           | `/api/state`                             | Owner workspace, explained matches, validated semantic scores, résumé metadata/text; no original bytes.                            |
| GET           | `/api/integrations`                      | Adapter/configuration booleans.                                                                                                    |
| PUT           | `/api/profile`                           | Contact info, roles/skills, links, notice period, salary, authorization notes.                                                     |
| POST          | `/api/resume`                            | Validated base64 file up to 5 MB; queue background extraction.                                                                     |
| PUT / DELETE  | `/api/resume/text` / `/api/resume`       | Edit extracted text / remove active résumé record.                                                                                 |
| GET           | `/api/resume/download`                   | Authenticated original bytes, hydrated from private local/S3 storage.                                                              |
| POST          | `/api/ai/extract`                        | `{confirmed:true}`; queue schema-validated model extraction.                                                                       |
| POST          | `/api/matching`                          | `{confirmed:true,jobIds:[]}`; 1–50 job descriptions plus résumé sent for embeddings.                                               |
| POST          | `/api/tailor`                            | `{jobId}`; queue a fact-preserving printable résumé version.                                                                       |
| GET           | `/api/vault`                             | Version metadata and share-link request counts.                                                                                    |
| GET           | `/api/vault/:id/download`                | Owner-only printable HTML; save as PDF in the browser.                                                                             |
| POST          | `/api/share/resume`                      | `{approved:true}`; create seven-day unlisted résumé link.                                                                          |
| POST          | `/api/share/:id/revoke`                  | Revoke a share grant.                                                                                                              |
| GET           | `/r/:token`                              | Explicit public grant; current-file binding, expiry, no-index response.                                                            |
| PUT           | `/api/settings`                          | Company-board slugs, daily cap, time zone, inbox automation/model opt-ins, exact approved answer bank.                             |
| POST          | `/api/jobs/sync`                         | `{source,board?}`; queue a supported source import.                                                                                |
| POST          | `/api/jobs/manual`                       | Title, company, valid HTTP(S) URL, location/work style, description.                                                               |
| POST          | `/api/applications`                      | Save one existing job without duplication.                                                                                         |
| POST          | `/api/applications/batch`                | `{jobIds:[]}`; prepare 1–50 jobs, never claim submission.                                                                          |
| PATCH         | `/api/applications/:id`                  | Stage/notes and history.                                                                                                           |
| GET           | `/api/applications/:id/packet`           | Plain-text application packet.                                                                                                     |
| GET           | `/api/export/applications`               | CSV with formula-leading characters neutralized.                                                                                   |
| POST          | `/api/apply/queue`                       | `{approved:true,jobIds:[]}`; 1–20 supported destinations in a personal, non-sample workspace.                                      |
| POST          | `/api/apply/:id/requeue`                 | Requeue an incomplete browser task.                                                                                                |
| POST          | `/api/apply/:id/confirm`                 | `{confirmationReference}`; owner records actual submission.                                                                        |
| POST / DELETE | `/api/extension/token`                   | Create a 24-hour bearer grant / revoke all extension grants.                                                                       |
| GET           | `/api/extension/next`                    | Extension bearer required; claim one ten-minute application lease.                                                                 |
| GET           | `/api/extension/resume`                  | Extension bearer required; original file for attachment.                                                                           |
| POST          | `/api/extension/report`                  | Bearer + lease; `needs-review` or `blocked` only, never Applied.                                                                   |
| POST          | `/api/contacts/import`                   | CSV up to 500 rows; per-row invalid/duplicate reporting.                                                                           |
| POST / PATCH  | `/api/contacts` / `/api/contacts/:id`    | Manual contact / suppression.                                                                                                      |
| POST          | `/api/contacts/apollo/search`            | Company domain and titles; current People API Search endpoint.                                                                     |
| POST          | `/api/contacts/apollo/save`              | Save selected IDs from the recent search.                                                                                          |
| POST          | `/api/contacts/:id/enrich`               | `{confirmCredits:true}`; selected work-email enrichment.                                                                           |
| POST          | `/api/contacts/:id/verify`               | `{confirmed:true}`; queue Hunter verification.                                                                                     |
| POST          | `/api/contacts/:id/personalize`          | `{confirmed:true,jobId?}`; queue a factual opener with an exact source quote.                                                      |
| POST / PATCH  | `/api/campaigns` / `/api/campaigns/:id`  | Draft fields, contact IDs, sender account, attachment flag, optional approved follow-up. Edit only before queue/delivery attempts. |
| POST          | `/api/campaigns/:id/preview`             | Exact per-recipient review, sequence text, attachment and sender.                                                                  |
| GET           | `/api/campaigns/:id/messages/:contactId` | Unsent `.eml` download, actual attachment bytes.                                                                                   |
| POST          | `/api/campaigns/:id/send`                | `{previewId,approved:true,confirmCount}`; atomically queue approved recipients.                                                    |
| POST          | `/api/campaigns/:id/pause`               | Cancel pending jobs and stop the sequence.                                                                                         |
| GET           | `/api/mail/accounts`                     | Safe mailbox configuration/status; no tokens.                                                                                      |
| GET           | `/api/oauth/:provider/start`             | Google/Microsoft authorization-code flow with PKCE.                                                                                |
| GET           | `/api/oauth/:provider/callback`          | Single-use state validation and encrypted token storage.                                                                           |
| POST          | `/api/mail/:id/sync`                     | Queue Gmail history/Graph delta sync.                                                                                              |
| POST          | `/api/mail/:id/watch`                    | Queue push watch/subscription setup and renewal.                                                                                   |
| POST          | `/api/mail/:id/disconnect`               | Remove credentials and cancel future account tasks.                                                                                |
| POST          | `/api/webhooks/gmail`                    | Validate Google OIDC push identity before queueing sync.                                                                           |
| POST          | `/api/webhooks/microsoft`                | Validation handshake, then stored subscription/clientState checks.                                                                 |
| POST          | `/api/inbox/analyze`                     | Manually linked, pasted update; suggestion only.                                                                                   |
| POST          | `/api/inbox/:id/accept`                  | Explicit application selection and suggestion approval.                                                                            |
| POST          | `/api/inbox/:id/dismiss`                 | Dismiss once.                                                                                                                      |
| GET           | `/api/tasks`                             | Bounded background/browser task status.                                                                                            |
| GET           | `/api/tasks/:id/logs`                    | Bounded task log.                                                                                                                  |
| POST          | `/api/tasks/:id/cancel`                  | Cancel a pending task.                                                                                                             |
| POST          | `/api/tasks/:id/retry`                   | Retry failed non-sending work; outbound unknowns are held.                                                                         |
| POST          | `/api/workspace/reset`                   | Explicit reset confirmation; running tasks block reset.                                                                            |

Stages: Saved, Ready, Applied, Assessment, Interview, Interview scheduled, Offer, Rejected, Withdrawn.

Campaign variables: `{{first_name}}`, `{{name}}`, `{{company}}`, `{{title}}`, `{{my_name}}`, `{{my_role}}`, `{{skills}}`, `{{portfolio}}`, `{{resume_url}}`, `{{icebreaker}}`. Unknown variables and subject newlines block review. A source change invalidates approval; provider acceptance is distinct from delivery.
