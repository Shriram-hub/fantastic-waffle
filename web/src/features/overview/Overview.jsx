import { symbols, names } from '../../shared/navigation.mjs';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApp, api, stages, split, fmt } from '../../shared/workspace.jsx';
import { Button, Badge, Heading, Empty, Panel, Field, Company, Modal, ConfirmAction, Sample } from '../../shared/ui.jsx';
import { ApplicationList } from '../tracker/ApplicationList.jsx';
import { AutopilotActivity } from '../automation/AutopilotActivity.jsx';
export function Overview() {
  const { data, tasks, go } = useApp(),
    applied = data.applications.filter((a) =>
      [
        "Applied",
        "Assessment",
        "Interview",
        "Interview scheduled",
        "Offer",
      ].includes(a.stage),
    ).length;
  const stats = [
    [data.jobs.filter((j) => !j.archived).length, "Opportunities"],
    [applied, "Applications in motion"],
    [data.contacts.filter((c) => !c.suppressed).length, "Contacts"],
    [
      tasks.tasks.filter((t) => ["queued", "running"].includes(t.status))
        .length,
      "Background tasks",
    ],
  ];
  return (
    <>
      <Heading
        title={`Your next chapter${data.profile.name ? `, ${data.profile.name.split(" ")[0]}` : ""}.`}
        subtitle="A little focus. A little momentum. Everything you need to make your next move."
      >
        <Button primary onClick={() => go("jobs")}>
          Explore opportunities →
        </Button>
      </Heading>
      <section className="hero">
        <div className="hero-text">
          <div className="eyebrow">YOUR CAREER, IN MOTION</div>
          <h2>
            Less busywork.
            <br />
            More possibility.
          </h2>
          <p>
            Discover roles, prepare applications, and start thoughtful
            conversations. Let your workspace keep track of the details.
          </p>
          <Button primary onClick={() => go("profile")}>
            Make your profile yours
          </Button>
        </div>
      </section>
      <div className="stats">
        {stats.map(([n, label]) => (
          <article className="stat" key={label}>
            <p className="stat-top">{label}</p>
            <strong>{String(n).padStart(2, "0")}</strong>
          </article>
        ))}
      </div>
      {data.inbox
        .filter((m) => m.deadline && !["Dismissed"].includes(m.status))
        .slice(0, 3)
        .map((m) => (
          <div className="urgent-card" key={m.id}>
            <div className="grow">
              <strong>Assessment needs your attention</strong>
              <p>
                {m.subject} · Deadline stated in email: {m.deadline}
              </p>
            </div>
            <Button small onClick={() => go("inbox")}>
              Review
            </Button>
          </div>
        ))}
      <div className="dashboard-grid">
        <Panel
          title="Your applications"
          subtitle="Every opportunity, one clear picture."
          action={
            <Button small onClick={() => go("applications")}>
              View all
            </Button>
          }
        >
          <ApplicationList list={data.applications.slice(-5).reverse()} />
        </Panel>
        <Panel title="Search at a glance" subtitle="Small steps add up.">
          <div className="panel-body">
            {[
              "Saved",
              "Ready",
              "Applied",
              "Assessment",
              "Interview",
              "Offer",
            ].map((stage) => (
              <div key={stage}>
                <div className="pipeline-summary">
                  <span>{stage}</span>
                  <strong>
                    {data.applications.filter((a) => a.stage === stage).length}
                  </strong>
                </div>
                <meter
                  min="0"
                  max={Math.max(1, data.applications.length)}
                  value={
                    data.applications.filter((a) => a.stage === stage).length
                  }
                  aria-label={stage}
                />
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <AutopilotActivity compact/>
      <div className="quick-links">
        {[
          [
            "profile",
            "Your profile & résumé",
            "One source of truth for every application.",
          ],
          [
            "contacts",
            "The people behind the roles",
            "Find and verify a focused contact list.",
          ],
          [
            "automation",
            "Work in the background",
            "Inspect imports, sends, and browser-assisted tasks.",
          ],
        ].map(([key, title, desc]) => (
          <button className="quick-card" key={key} onClick={() => go(key)}>
            <span>{symbols[key]}</span>
            <div className="grow">
              <strong>{title}</strong>
              <p>{desc}</p>
            </div>
            <span>→</span>
          </button>
        ))}
      </div>
    </>
  );
}
