import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApp, api, stages, split, fmt } from '../../shared/workspace.jsx';
import { Button, Badge, Heading, Empty, Panel, Field, Company, Modal, ConfirmAction, Sample } from '../../shared/ui.jsx';
export function Jobs() {
  const { data, integrations, perform, notify, setModal, go } = useApp(),
    [q, setQ] = useState(""),
    [mode, setMode] = useState(""),
    [location, setLocation] = useState(""),
    [source, setSource] = useState(""),
    [selected, setSelected] = useState(new Set()),
    [limit, setLimit] = useState(24);
  const list = useMemo(
    () =>
      data.jobs
        .filter(
          (j) =>
            !j.archived &&
            (!q ||
              `${j.title} ${j.company} ${j.tags?.join(" ")} ${j.category}`
                .toLowerCase()
                .includes(q.toLowerCase())) &&
            (!location ||
              j.location.toLowerCase().includes(location.toLowerCase())) &&
            (!mode || j.workMode === mode) &&
            (!source ||
              j.sources?.some((s) => s.source === source) ||
              j.source === source),
        )
        .sort(
          (a, b) =>
            (b.semanticMatch?.score ?? b.match.score ?? 0) -
            (a.semanticMatch?.score ?? a.match.score ?? 0),
        ),
    [data, q, location, mode, source],
  );
  const toggle = (jid) =>
    setSelected((previous) => {
      const next = new Set(previous);
      next.has(jid) ? next.delete(jid) : next.add(jid);
      return next;
    });
  async function refresh() {
    const sources = [
      { source: "Remotive" },
      { source: "Arbeitnow" },
      ...["greenhouse", "lever", "ashby"].flatMap((source) =>
        (data.settings[`${source}Boards`] || []).map((board) => ({
          source: source[0].toUpperCase() + source.slice(1),
          board,
        })),
      ),
      ...(integrations.adzuna ? [{ source: "Adzuna" }] : []),
    ];
    for (const s of sources) await api("/jobs/sync", s);
    notify(
      `${sources.length} imports queued. Start the worker to process them.`,
    );
  }
  return (
    <>
      <Heading
        title="Find your next thing."
        subtitle="Browse sources, compare your profile, and build a focused shortlist."
      >
        <Button onClick={() => setModal({ type: "add-job" })}>
          + Add a job
        </Button>
        <Button primary disabled={false} onClick={() => perform(refresh)}>
          Refresh sources
        </Button>
      </Heading>
      <div className="toolbar">
        <label className="search-input">
          <input
            aria-label="Role, skill, or company"
            placeholder="Role, skill, or company…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <label className="search-input">
          <input
            aria-label="Job location"
            placeholder="City, country, or worldwide…"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </label>
        <select
          aria-label="Work style"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="">All work styles</option>
          {["Remote", "Hybrid", "On-site"].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <select
          aria-label="Source"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="">All sources</option>
          {[
            "Sample",
            "Remotive",
            "Greenhouse",
            "Lever",
            "Ashby",
            "Arbeitnow",
            "Adzuna",
            "Manual",
          ].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <p className="list-summary">
        {list.length} opportunities · Sorted by semantic score where available,
        otherwise profile keywords.
      </p>
      <div className="job-grid">
        {list.slice(0, limit).map((j) => (
          <article
            className={`job-card${selected.has(j.id) ? " is-selected" : ""}`}
            key={j.id}
          >
            <div className="job-top">
              <input
                type="checkbox"
                className="job-select"
                checked={selected.has(j.id)}
                onChange={() => toggle(j.id)}
                aria-label={`Select ${j.title} at ${j.company}`}
              />
              <Company name={j.company} />
              <div className="grow">
                <p className="company-name">
                  {j.company} <Sample value={j.isDemo} />
                </p>
                <button onClick={() => setModal({ type: "job", id: j.id })}>
                  <h3>{j.title}</h3>
                </button>
              </div>
              <button
                className="icon-button"
                onClick={() =>
                  perform(async () => {
                    await api("/applications", { jobId: j.id, stage: "Saved" });
                    notify("Saved to your tracker.");
                  })
                }
                aria-label={`Save ${j.title}`}
              >
                ☆
              </button>
            </div>
            <div className="job-meta">
              <span>{j.location}</span>
              <span>{j.workMode}</span>
            </div>
            <div className="job-tags">
              {j.tags?.slice(0, 4).map((tag, i) => (
                <span className="tag" key={`${tag}-${i}`}>
                  {tag}
                </span>
              ))}
              <span className="tag">
                {j.sources
                  ?.map((s) => s.source)
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .join(" + ") || j.source}
              </span>
            </div>
            <div className="job-footer">
              <strong className="salary">{j.salary}</strong>
              <span className="match">
                {j.semanticMatch
                  ? `${j.semanticMatch.score}% semantic`
                  : `${j.match.score ?? "—"}% keyword`}
              </span>
            </div>
          </article>
        ))}
      </div>
      {!list.length && (
        <section className="panel">
          <Empty title="No opportunities here yet.">
            Try broader filters, add a job, or refresh configured sources.
          </Empty>
        </section>
      )}
      {list.length > limit && (
        <div className="form-actions">
          <Button onClick={() => setLimit(limit + 24)}>Show more</Button>
        </div>
      )}
      {selected.size > 0 && (
        <div className="bulk-bar">
          <strong>{selected.size} selected</strong>
          <Button
            onClick={() =>
              perform(async () => {
                await api("/applications/batch", { jobIds: [...selected] });
                setSelected(new Set());
                go("applications");
              })
            }
          >
            Prepare applications
          </Button>
          <Button
            onClick={() =>
              setModal({ type: "browser-batch", ids: [...selected] })
            }
          >
            Browser-assisted fill
          </Button>
          <Button
            onClick={() => setModal({ type: "embeddings", ids: [...selected] })}
          >
            Semantic match
          </Button>
          <button onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      <div className="notice mt">
        Keyword and embedding scores help with discovery; neither predicts
        hiring success. Check eligibility and requirements on the original
        listing. Remotive and other feeds retain source links.
      </div>
      <div className="btn-row mt">
        {[
          ["LinkedIn", "https://www.linkedin.com/jobs/"],
          ["Indeed", "https://www.indeed.com/"],
          ["Naukri", "https://www.naukri.com/"],
          ["Wellfound", "https://wellfound.com/jobs"],
        ].map(([n, url]) => (
          <a
            className="btn small"
            href={url}
            target="_blank"
            rel="noreferrer"
            key={n}
          >
            {n} ↗
          </a>
        ))}
      </div>
    </>
  );
}