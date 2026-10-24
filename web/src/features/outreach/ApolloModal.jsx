import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApp, api, stages, split, fmt } from '../../shared/workspace.jsx';
import { Button, Badge, Heading, Empty, Panel, Field, Company, Modal, ConfirmAction, Sample } from '../../shared/ui.jsx';
export function ApolloModal({ close }) {
  const { perform, notify } = useApp(),
    [result, setResult] = useState([]),
    [selected, setSelected] = useState(new Set()),
    [employees, setEmployees] = useState(""),
    [titles, setTitles] = useState(
      "Technical Recruiter, University Recruiter, Engineering Manager",
    );
  return (
    <Modal title="Find the people behind the opportunity" onClose={close} wide>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const values = Object.fromEntries(new FormData(e.currentTarget));
          perform(async () =>
            setResult((await api("/contacts/apollo/search", values)).contacts),
          );
        }}
      >
        <div className="form-grid">
          <Field label="Company domain">
            <input className="input" name="domain" placeholder="company.com" />
          </Field>
          <Field label="Company employees (if known)">
            <input
              className="input"
              type="number"
              min="1"
              value={employees}
              onChange={(e) => {
                setEmployees(e.target.value);
                setTitles(
                  Number(e.target.value) > 0 && Number(e.target.value) < 50
                    ? "Founder, CTO, VP Engineering, Head of Talent"
                    : "Technical Recruiter, University Recruiter, Engineering Manager",
                );
              }}
            />
          </Field>
        </div>
        <Field label="Target titles">
          <input
            className="input"
            name="titles"
            value={titles}
            onChange={(e) => setTitles(e.target.value)}
          />
        </Field>
        <Button primary type="submit">
          Search up to 25 people
        </Button>
      </form>
      <div className="contact-list mt">
        {result.map((c) => (
          <label className="contact-row" key={c.id}>
            <input
              type="checkbox"
              checked={selected.has(c.id)}
              onChange={(e) =>
                setSelected((old) => {
                  const next = new Set(old);
                  e.target.checked ? next.add(c.id) : next.delete(c.id);
                  return next;
                })
              }
            />
            <div>
              <strong>{c.name}</strong>
              <p>
                {c.title} · {c.company}
              </p>
            </div>
          </label>
        ))}
      </div>
      {result.length > 0 && (
        <div className="form-actions">
          <Button
            primary
            onClick={() =>
              perform(async () => {
                const r = await api("/contacts/apollo/save", {
                  ids: [...selected],
                });
                notify(
                  `${r.added} contacts saved. Enrich selected contacts to request work emails.`,
                );
                close();
              })
            }
          >
            Save selected contacts
          </Button>
        </div>
      )}
      <p className="hint">
        People search does not reveal work emails. Enrichment and independent
        verification are separate actions with provider-specific costs.
      </p>
    </Modal>
  );
}