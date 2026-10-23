import {QuickMassMailer} from './QuickMassMailer.jsx';
import {QueueNowButton} from '../../shared/QueueNowButton.jsx';
import {SequenceBuilder,followupDefaults} from './SequenceBuilder.jsx';
import {JobDocuments} from '../resume/JobDocuments.jsx';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApp, api, stages, split, fmt } from '../../shared/workspace.jsx';
import { Button, Badge, Heading, Empty, Panel, Field, Company, Modal, ConfirmAction, Sample } from '../../shared/ui.jsx';
export function Outreach() {
  const { data, accounts, perform, setModal, notify } = useApp(),
    [draft, setDraft] = useState({
      name: "",
      subject: "Exploring {{my_role}} opportunities at {{company}}",
      body: "Hi {{first_name}},\n\n{{warm_hook}}\n\nI’m {{my_name}}, a {{my_role}}. I’m interested in the work your team is doing at {{company}}. My background includes {{skills}}.\n\nYou can find my résumé here: {{resume_url}}\n\nWould you be open to a brief conversation?",
      accountId: accounts.length===1 ? accounts[0].id : "",
      jobId:"",documentSetId:"",trackResume:false,attachCoverLetter:false,
      attachResume: false,
      contactIds: [],
      sequence: {
        enabled: false,steps:followupDefaults,
        afterBusinessDays: 4,
        body: "Hi {{first_name}}, I wanted to follow up on my earlier note about opportunities at {{company}}. Would it be useful if I shared more context on my background?",
      },
    }),
    [editing, setEditing] = useState(null);
  const update = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  async function save(preview) {
    const result = await api(
      editing ? `/campaigns/${editing}` : "/campaigns",
      draft,
      editing ? "PATCH" : "POST",
    );
    setEditing(result.campaign.id);
    if (preview) setModal({ type: "campaign-preview", id: result.campaign.id });
    else notify("Draft saved.");
  }
  return (
    <>
      <Heading
        title="A thoughtful hello goes further."
        subtitle="Personalize your introduction. Preview every recipient. Send with measured pacing."
      ><QueueNowButton/></Heading>
      <QuickMassMailer/><details className="advanced-campaigns"><summary>Advanced campaign editor & saved campaigns</summary><div className="two-column">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            perform(() => save(true));
          }}
        >
          <section className="form-section">
            <h2>Your next introduction</h2>
            <p>
              Messages are sent individually. Sequences stop on a detected
              reply, suppression, or pause.
            </p>
            <div className="stack">
              <Field label="Campaign name">
                <input
                  className="input"
                  required
                  value={draft.name}
                  onChange={(e) => update("name", e.target.value)}
                />
              </Field>
              <Field label="Send from">
                <select
                  value={draft.accountId}
                  onChange={(e) => update("accountId", e.target.value)}
                >
                  <option value="">Resend / preview mode</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.email} · {a.provider}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Subject">
                <input
                  className="input"
                  required
                  value={draft.subject}
                  onChange={(e) => update("subject", e.target.value)}
                />
              </Field>
              <Field label="Message">
                <textarea
                  className="textarea-lg"
                  required
                  value={draft.body}
                  onChange={(e) => update("body", e.target.value)}
                />
              </Field>
              <p className="compose-help">
                {
                  "{{first_name}} · {{company}} · {{my_name}} · {{my_role}} · {{skills}} · {{resume_url}} · {{icebreaker}}"
                }
              </p>
              <label className="checkbox-group">
                <input
                  type="checkbox"
                  checked={draft.attachResume}
                  onChange={(e) => update("attachResume", e.target.checked)}
                />
                Attach résumé (tailored PDF when selected above)
              </label>
              <Field label="Related job (for tailored documents)"><select value={draft.jobId || ''} onChange={e=>{update('jobId',e.target.value);update('documentSetId','');}}><option value="">General introduction</option>{data.jobs.filter(j=>!j.archived).slice(0,300).map(j=><option key={j.id} value={j.id}>{j.company} · {j.title}</option>)}</select></Field>
              {draft.jobId && <JobDocuments jobId={draft.jobId} onReady={document=>update('documentSetId',document?.id || '')}/>}
              {draft.documentSetId && <label className="checkbox-group"><input type="checkbox" checked={draft.attachCoverLetter || false} onChange={e=>update('attachCoverLetter',e.target.checked)}/>Also attach the tailored cover letter</label>}
              <label className="checkbox-group"><input type="checkbox" checked={draft.trackResume || false} onChange={e=>update('trackResume',e.target.checked)}/>Use a recipient-specific résumé link (expires after 30 days)</label>
              <SequenceBuilder value={draft.sequence} onChange={value=>update('sequence',value)}/>
            </div>
          </section>
          <section className="form-section">
            <div className="spread mb">
              <h2>Who would you like to reach?</h2>
              <span className="small muted">
                {draft.contactIds.length} selected
              </span>
            </div>
            <div className="contact-list">
              {data.contacts
                .filter((c) => !c.suppressed)
                .map((c) => (
                  <label className="contact-row" key={c.id}>
                    <input
                      type="checkbox"
                      checked={draft.contactIds.includes(c.id)}
                      onChange={(e) =>
                        update(
                          "contactIds",
                          e.target.checked
                            ? [...draft.contactIds, c.id]
                            : draft.contactIds.filter((id) => id !== c.id),
                        )
                      }
                    />
                    <div className="grow">
                      <strong>
                        {c.name} · {c.company}
                      </strong>
                      <p>{c.email || "Email enrichment needed"}</p>
                    </div>
                    <Sample value={c.isDemo} />
                    <Badge value={c.emailStatus} />
                  </label>
                ))}
            </div>
            <div className="form-actions">
              <Button onClick={() => perform(() => save(false))}>
                Save draft
              </Button>
              <Button primary type="submit">
                Review campaign
              </Button>
            </div>
          </section>
        </form>
        <div>
          <section className="form-section">
            <h2>Measured sending, clear results.</h2>
            <p>
              Default cap: 30 messages per account per UTC day. Pacing spreads
              sends 3–8 minutes apart inside the configured business-hour
              window. These settings do not guarantee inbox placement.
            </p>
            <p className="notice">
              No real messages leave Veloce until the server enables sending and
              you approve the campaign. Unknown provider acceptance is held for
              reconciliation.
            </p>
          </section>
          <Panel title="Your campaigns">
            {data.campaigns.map((c) => (
              <div className="campaign-row" key={c.id}>
                <div className="grow">
                  <h3>{c.name}</h3>
                  <p>
                    {c.contactIds.length} recipients · {c.status}
                  </p>
                </div>
                {!c.deliveries.length && (
                  <Button
                    small
                    onClick={() => {
                      setDraft({
                        ...c,
                        sequence: c.sequence || {
                          enabled: false,
                          afterBusinessDays: 4,
                          body: "",
                        },
                      });
                      setEditing(c.id);
                    }}
                  >
                    Edit
                  </Button>
                )}
                <Button
                  small
                  onClick={() =>
                    setModal({ type: "campaign-preview", id: c.id })
                  }
                >
                  Review
                </Button>
                {c.deliveries.some((d) => d.status === "queued" || d.followups?.some(s=>s.status==='queued')) && (
                  <Button
                    small
                    onClick={() =>
                      perform(
                        () => api(`/campaigns/${c.id}/pause`, {}),
                        "Campaign paused.",
                      )
                    }
                  >
                    Pause
                  </Button>
                )}
              </div>
            ))}
            {!data.campaigns.length && (
              <Empty title="Your first hello is waiting.">
                Campaign drafts and delivery results will appear here.
              </Empty>
            )}
          </Panel>
        </div>
      </div></details>
    </>
  );
}