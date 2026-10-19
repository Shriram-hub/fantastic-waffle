import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApp, api, stages, split, fmt } from '../../shared/workspace.jsx';
import { Button, Badge, Heading, Empty, Panel, Field, Company, Modal, ConfirmAction, Sample } from '../../shared/ui.jsx';
export function AddJobModal({ close }) {
  const { perform, go } = useApp();
  return (
    <Modal title="Add an opportunity" onClose={close}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const v = Object.fromEntries(new FormData(e.currentTarget));
          perform(async () => {
            const r = await api("/jobs/manual", v);
            await api("/applications", { jobId: r.job.id, stage: v.stage });
            close();
            go("applications");
          });
        }}
      >
        <div className="form-grid">
          {[
            ["title", "Role", "text"],
            ["company", "Company", "text"],
            ["url", "Application URL", "url"],
            ["location", "Location", "text"],
          ].map(([name, label, type]) => (
            <Field label={label} key={name}>
              <input className="input" name={name} type={type} required />
            </Field>
          ))}
          <Field label="Work style">
            <select name="workMode">
              {["Remote", "Hybrid", "On-site"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
          <Field label="Stage">
            <select name="stage">
              {stages.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Description">
          <textarea name="description" rows="5" />
        </Field>
        <div className="form-actions">
          <Button primary type="submit">
            Add to tracker
          </Button>
        </div>
      </form>
    </Modal>
  );
}