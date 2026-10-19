import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApp, api, stages, split, fmt } from '../../shared/workspace.jsx';
import { Button, Badge, Heading, Empty, Panel, Field, Company, Modal, ConfirmAction, Sample } from '../../shared/ui.jsx';
export function Contacts() {
  const { data, perform, notify, setModal } = useApp(),
    [q, setQ] = useState(""),
    list = data.contacts.filter((c) =>
      `${c.name} ${c.company} ${c.title} ${c.email}`
        .toLowerCase()
        .includes(q.toLowerCase()),
    );
  return (
    <>
      <Heading
        title="Meet the people behind the roles."
        subtitle="Find relevant contacts, verify their work email, and build a focused list."
      >
        <Button onClick={() => setModal({ type: "import-contacts" })}>
          Import CSV
        </Button>
        <Button onClick={() => setModal({ type: "add-contact" })}>
          + Add contact
        </Button>
        <Button primary onClick={() => setModal({ type: "apollo" })}>
          Find with Apollo
        </Button>
      </Heading>
      <div className="toolbar">
        <label className="search-input">
          <input
            placeholder="Search people, companies, or roles…"
            aria-label="Search contacts"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </div>
      <Panel title={`${list.length} contacts`}>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>PERSON</th>
                <th>COMPANY & ROLE</th>
                <th>WORK EMAIL</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.name}</strong>
                    {c.icebreaker && (
                      <p className="hint">
                        {c.icebreaker}
                        <br />
                        Source: {c.icebreakerEvidence}
                      </p>
                    )}
                    <span className="muted">
                      {c.source} <Sample value={c.isDemo} />
                    </span>
                  </td>
                  <td>
                    <strong>{c.company}</strong>
                    <span className="muted">{c.title}</span>
                  </td>
                  <td>
                    <strong>{c.email || "Enrichment needed"}</strong>
                    <Badge
                      value={c.suppressed ? "suppressed" : c.emailStatus}
                    />
                    {c.verification && (
                      <span className="data-badge">
                        {" "}
                        · {c.verification.provider}
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="btn-row">
                      {!c.email && c.apolloId && (
                        <Button
                          small
                          onClick={() => setModal({ type: "enrich", id: c.id })}
                        >
                          Enrich
                        </Button>
                      )}
                      {c.email && !c.isDemo && (
                        <Button
                          small
                          onClick={() => setModal({ type: "verify", id: c.id })}
                        >
                          Verify
                        </Button>
                      )}
                      <Button
                        small
                        onClick={() =>
                          setModal({ type: "personalize", id: c.id })
                        }
                      >
                        Draft opener
                      </Button>
                      <Button
                        small
                        onClick={() =>
                          perform(
                            () =>
                              api(
                                `/contacts/${c.id}`,
                                { suppressed: !c.suppressed },
                                "PATCH",
                              ),
                            c.suppressed
                              ? "Contact restored."
                              : "Contact suppressed from outreach.",
                          )
                        }
                      >
                        {c.suppressed ? "Restore" : "Suppress"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!list.length && (
          <Empty title="Your first connection starts here.">
            Search Apollo, import a CSV, or add a contact manually.
          </Empty>
        )}
      </Panel>
      <div className="notice">
        Apollo search and enrichment are separate. Verification is a separate
        paid lookup when Hunter is configured. Catch-all, invalid, sample, and
        unverified emails cannot be sent. CSV verification labels are supplied
        by your source and are not independently checked by Orbit.
      </div>
    </>
  );
}