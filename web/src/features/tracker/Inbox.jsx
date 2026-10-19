import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApp, api, stages, split, fmt } from '../../shared/workspace.jsx';
import { Button, Badge, Heading, Empty, Panel, Field, Company, Modal, ConfirmAction, Sample } from '../../shared/ui.jsx';
export function Inbox() {
  const { data, accounts, perform, setModal } = useApp();
  return (
    <>
      <Heading
        title="The next step, without the guesswork."
        subtitle="Mailbox events become status suggestions, assessment links, and reviewed actions."
      >
        <Button onClick={() => setModal({ type: "import-email" })}>
          Paste an update
        </Button>
        {accounts.map((a) => (
          <Button
            primary
            key={a.id}
            onClick={() =>
              perform(
                () => api(`/mail/${a.id}/sync`, {}),
                "Mailbox sync queued.",
              )
            }
          >
            Sync {a.provider}
          </Button>
        ))}
      </Heading>
      {!accounts.length && (
        <div className="banner info">
          <span>
            Connect Google or Microsoft in Connections for inbox sync. Pasted
            updates also work.
          </span>
        </div>
      )}
      <Panel
        title="Application updates"
        subtitle="Only unique role matches can transition automatically when you opt in."
      >
        {data.inbox.map((item) => (
          <InboxItem key={item.id} item={item} />
        ))}
        {!data.inbox.length && (
          <Empty title="Room for good news.">
            Import a confirmation, interview invitation, assessment, or decision
            email.
          </Empty>
        )}
      </Panel>
    </>
  );
}
export function InboxItem({ item }) {
  const { data, perform } = useApp(),
    [applicationId, setApplication] = useState(item.applicationId || "");
  return (
    <article className="inbox-item">
      <div className="spread">
        <span className="small muted">
          {item.from || "Imported email"} ·{" "}
          {fmt(item.receivedAt || item.createdAt)}
        </span>
        <Badge value={item.status} />
      </div>
      <h3>{item.subject}</h3>
      <p>{item.body.slice(0, 600)}</p>
      {item.deadline && (
        <div className="notice mt">
          Deadline stated in email: <strong>{item.deadline}</strong>
          {item.links?.map((link) => (
            <p key={link}>
              <a href={link} target="_blank" rel="noreferrer">
                Open assessment / action link ↗
              </a>
            </p>
          ))}
        </div>
      )}
      {item.status === "Needs review" && (
        <div className="inline-form mt">
          <Field
            label={item.ambiguous ? "Choose the correct role" : "Application"}
          >
            <select
              value={applicationId}
              onChange={(e) => setApplication(e.target.value)}
            >
              <option value="">Choose an application</option>
              {data.applications.map((a) => {
                const j = data.jobs.find((j) => j.id === a.jobId);
                return (
                  <option key={a.id} value={a.id}>
                    {j?.company} · {j?.title}
                  </option>
                );
              })}
            </select>
          </Field>
          <Badge value={item.proposedStage || "No status detected"} />
          <Button
            small
            disabled={!applicationId || !item.proposedStage}
            primary
            onClick={() =>
              perform(
                () => api(`/inbox/${item.id}/accept`, { applicationId }),
                "Tracker updated from reviewed email.",
              )
            }
          >
            Apply suggestion
          </Button>
          <Button
            small
            onClick={() => perform(() => api(`/inbox/${item.id}/dismiss`, {}))}
          >
            Dismiss
          </Button>
        </div>
      )}
    </article>
  );
}