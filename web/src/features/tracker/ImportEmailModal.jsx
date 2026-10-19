import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApp, api, stages, split, fmt } from '../../shared/workspace.jsx';
import { Button, Badge, Heading, Empty, Panel, Field, Company, Modal, ConfirmAction, Sample } from '../../shared/ui.jsx';
export function ImportEmailModal({ close }) {
  const { data, perform, go } = useApp();
  return (
    <Modal title="Bring an update into view" onClose={close}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const values = Object.fromEntries(new FormData(e.currentTarget));
          perform(async () => {
            await api("/inbox/analyze", values);
            close();
            go("inbox");
          });
        }}
      >
        <Field label="Application">
          <select name="applicationId" required>
            {data.applications.map((a) => {
              const j = data.jobs.find((j) => j.id === a.jobId);
              return (
                <option value={a.id} key={a.id}>
                  {j?.company} · {j?.title}
                </option>
              );
            })}
          </select>
        </Field>
        <Field label="From">
          <input className="input" name="from" />
        </Field>
        <Field label="Subject">
          <input className="input" name="subject" required />
        </Field>
        <Field label="Email body">
          <textarea rows="8" name="body" required />
        </Field>
        <Button type="submit" primary>
          Analyze for review
        </Button>
      </form>
    </Modal>
  );
}