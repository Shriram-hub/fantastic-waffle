import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApp, api, stages, split, fmt } from '../../shared/workspace.jsx';
import { Button, Badge, Heading, Empty, Panel, Field, Company, Modal, ConfirmAction, Sample } from '../../shared/ui.jsx';
import { ApplicationList } from '../tracker/ApplicationList.jsx';
export function Applications() {
  const { data, setModal } = useApp(),
    [view, setView] = useState("board"),
    [stage, setStage] = useState(""),
    list = data.applications.filter((a) => !stage || a.stage === stage);
  return (
    <>
      <Heading
        title="Every opportunity, in view."
        subtitle="Track what happened, what comes next, and the details worth keeping."
      >
        <a className="btn" href="/api/export/applications">
          Export CSV
        </a>
        <Button primary onClick={() => setModal({ type: "add-job" })}>
          + Add application
        </Button>
      </Heading>
      <div className="toolbar">
        <select
          aria-label="Application stage"
          value={stage}
          onChange={(e) => setStage(e.target.value)}
        >
          <option value="">All stages</option>
          {stages.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <span className="grow muted small">
          {list.length} tracked opportunities
        </span>
        <Button small onClick={() => setView("board")}>
          Board
        </Button>
        <Button small onClick={() => setView("list")}>
          List
        </Button>
      </div>
      {view === "list" ? (
        <Panel title="Applications">
          <ApplicationList list={list} />
        </Panel>
      ) : (
        <div className="board">
          {(stage ? [stage] : stages).map((s) => (
            <section className="board-column" key={s}>
              <div className="board-heading">
                <Badge value={s} />
                <span>{list.filter((a) => a.stage === s).length}</span>
              </div>
              {list
                .filter((a) => a.stage === s)
                .map((a) => {
                  const j = data.jobs.find((j) => j.id === a.jobId);
                  return (
                    <button
                      className="application-card"
                      key={a.id}
                      onClick={() =>
                        setModal({ type: "application", id: a.id })
                      }
                    >
                      <div className="spread">
                        <Company name={j?.company} />
                        <Sample value={j?.isDemo} />
                      </div>
                      <h3>{j?.title}</h3>
                      <p>{j?.company}</p>
                      <p className="date">{fmt(a.updatedAt)}</p>
                    </button>
                  );
                })}
            </section>
          ))}
        </div>
      )}
      <div className="notice mt">
        Prepared and browser-filled applications remain Ready until you complete
        the employer form. Automatic inbox updates require opt-in and a unique
        role match; ambiguous messages stay in review.
      </div>
    </>
  );
}