import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApp, api, stages, split, fmt } from '../../shared/workspace.jsx';
import { Button, Badge, Heading, Empty, Panel, Field, Company, Modal, ConfirmAction, Sample } from '../../shared/ui.jsx';
export function CampaignPreview({ id, close }) {
  const { data, perform, notify } = useApp(),
    [preview, setPreview] = useState(null),
    [index, setIndex] = useState(0),
    [approved, setApproved] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    api(`/campaigns/${id}/preview`, {})
      .then(setPreview)
      .catch((e) => setError(e.message));
  }, [id]);
  const c = data.campaigns.find((c) => c.id === id),
    m = preview?.messages[index],
    canSend =
      preview?.liveSendReady &&
      preview.messages.every((m) => !m.isDemo && m.emailStatus === "verified");
  return (
    <Modal title="A final look before hello." onClose={close} wide>
      {error ? (
        <p className="error-box">{error}</p>
      ) : !preview ? (
        <p>Preparing your review…</p>
      ) : (
        <>
          <div className="spread mb">
            <p className="small muted">
              {preview.messages.length} initial messages
              {preview.sequence?.enabled
                ? ` + up to ${preview.messages.length*(preview.sequence.steps?.length || 1)} follow-ups`
                : ""}{" "}
              · {preview.excluded.length} excluded
            </p>
            <Badge value={canSend ? "Ready for approval" : "Preview only"} />
          </div>
          <div className="preview-tabs">
            {preview.messages.map((message, i) => (
              <button
                key={message.contactId}
                className={`draft-choice${index === i ? " active" : ""}`}
                onClick={() => setIndex(i)}
              >
                {message.name}
              </button>
            ))}
          </div>
          <div className="email-preview">
            <div className="email-header">
              From <strong>{preview.sender}</strong>
              <br />
              To <strong>{m.to}</strong>
              <br />
              Subject <strong>{m.subject}</strong>
            </div>
            <div className="email-body">{m.body}</div>
            {preview.attachment && (
              <div className="attachment">
                Attachment: {preview.attachment.name}{c?.attachCoverLetter && preview.documents ? ` + ${preview.documents.coverLetter.name}` : ''}
              </div>
            )}
          </div>
          {preview.documents && <div className="document-downloads"><strong>Tailored files for {preview.documents.company}</strong><a className="btn small" href={`/api/documents/${preview.documents.id}/resume`}>Review résumé PDF</a><a className="btn small" href={`/api/documents/${preview.documents.id}/coverLetter`}>Review cover letter PDF</a></div>}
          {preview.sequence?.enabled && <div className="notice mt">{(preview.followupMessages?.[index]?.steps || [{afterBusinessDays:preview.sequence.afterBusinessDays,body:preview.followupMessages?.[index]?.body}]).map((step,i)=><div className="sequence-step" key={i}><strong>Follow-up {i+1} · {step.afterBusinessDays} business days after the first email</strong><p className="pre">{step.body}</p></div>)}<p className="hint">Stopped by a company reply, suppression, pause, changed content, or stale inbox sync.</p></div>}
          {preview.excluded.length > 0 && (
            <p className="hint">
              {preview.excluded
                .map((e) => `${e.name}: ${e.reason}`)
                .join(" · ")}
            </p>
          )}
          <div className="notice mt">
            {canSend
              ? "Sends are queued in the configured 09:00–11:00 business-hour window, with pacing and a daily cap."
              : "No messages will be sent. Connect/configure a sender, enable live sending on the server, and use real verified contacts."}
          </div>
          {canSend && (
            <label className="checkbox-group mt">
              <input
                type="checkbox"
                checked={approved}
                onChange={(e) => setApproved(e.target.checked)}
              />
              I approve these recipients, message, attachment/link, and any
              shown follow-up.
            </label>
          )}
          <div className="form-actions">
            <a
              className="btn"
              href={`/api/campaigns/${id}/messages/${m.contactId}`}
            >
              Download this draft
            </a>
            {canSend && (
              <Button
                primary
                disabled={!approved}
                onClick={() =>
                  perform(async () => {
                    await api(`/campaigns/${id}/send`, {
                      previewId: preview.previewId,
                      approved: true,
                      confirmCount: preview.messages.length,
                    });
                    notify("Campaign queued. Follow progress in Automation.");
                    close();
                  })
                }
              >
                Queue approved campaign
              </Button>
            )}
          </div>
          {c?.deliveries?.length > 0 && (
            <div className="mt">
              <h3 className="secondary-heading">Recipient results</h3>
              {c.deliveries.map((d, i) => (
                <div className="contact-row" key={i}>
                  <div className="grow">
                    <strong>
                      {data.contacts.find((c) => c.id === d.contactId)?.name}
                    </strong>
                    <p>
                      {d.scheduledAt ? `Scheduled ${fmt(d.scheduledAt)}` : ""}{" "}
                      {d.error}
                    </p>
                  </div>
                  <Badge value={d.status} />
                  {d.followups?.map(step=><Badge key={step.step} value={`Step ${step.step}: ${step.status}`}/>)}
                  {!d.followups?.length && d.followupStatus && (
                    <Badge value={`Follow-up: ${d.followupStatus}`} />
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}