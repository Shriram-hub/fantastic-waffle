import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApp, api, stages, split, fmt } from '../../shared/workspace.jsx';
import { Button, Badge, Heading, Empty, Panel, Field, Company, Modal, ConfirmAction, Sample } from '../../shared/ui.jsx';
export function ApplicationModal({ id, close }) {
  const { data, perform } = useApp(),
    a = data.applications.find((a) => a.id === id),
    j = data.jobs.find((j) => j.id === a?.jobId),
    [stage, setStage] = useState(a.stage),
    [notes, setNotes] = useState(a.notes);
  return (
    <Modal title="Your application" onClose={close}>
      <div className="spread">
        <Company name={j.company} />
        <Sample value={j.isDemo} />
      </div>
      <h2 className="detail-title">{j.title}</h2>
      <p className="detail-company">
        {j.company} · {j.location}
      </p>
      <form
        className="stack mt"
        onSubmit={(e) => {
          e.preventDefault();
          perform(
            () => api(`/applications/${id}`, { stage, notes }, "PATCH"),
            "Application saved.",
          );
        }}
      >
        <Field label="Stage">
          <select value={stage} onChange={(e) => setStage(e.target.value)}>
            {stages.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Your notes">
          <textarea
            rows="5"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        <Button primary type="submit">
          Save changes
        </Button>
      </form>
      <div className="app-detail-links">
        <a className="btn small" href={`/api/applications/${id}/packet`}>
          Download packet
        </a>
        {j.url && (
          <a
            className="btn small"
            target="_blank"
            rel="noreferrer"
            href={j.url}
          >
            Open employer form ↗
          </a>
        )}
      </div>
      <div className="timeline">
        {[...a.history]
          .reverse()
          .slice(0, 10)
          .map((event, i) => (
            <div className="timeline-item" key={i}>
              <strong>{event.stage}</strong>
              <p>
                {event.source} · {fmt(event.at)}
              </p>
            </div>
          ))}
      </div>
    </Modal>
  );
}