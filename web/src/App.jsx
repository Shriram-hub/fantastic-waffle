import React, { useEffect, useState, useRef } from 'react';
import { WorkspaceContext as Context, api } from './shared/workspace.jsx';
import { Button } from './shared/ui.jsx';
import { Overview } from './features/overview/Overview.jsx';
import { Jobs } from './features/jobs/Jobs.jsx';
import { Applications } from './features/tracker/Applications.jsx';
import { Profile } from './features/resume/Profile.jsx';
import { Contacts } from './features/outreach/Contacts.jsx';
import { Outreach } from './features/outreach/Outreach.jsx';
import { Inbox } from './features/tracker/Inbox.jsx';
import { Automation } from './features/automation/Automation.jsx';
import { Connections } from './features/connections/Connections.jsx';
import { ModalContent } from './features/modals/ModalContent.jsx';
import { symbols, names } from './shared/navigation.mjs';
export default function App() {
  const [data, setData] = useState(null),
    [integrations, setIntegrations] = useState({}),
    [accounts, setAccounts] = useState([]),
    [tasks, setTasks] = useState({ tasks: [], applications: [] }),
    [vault, setVault] = useState({ versions: [], links: [] }),
    [autopilot, setAutopilot] = useState(null),
    [route, setRoute] = useState(location.hash.slice(1) || "overview"),
    [modal, setModal] = useState(null),
    [notice, setNotice] = useState(null),
    [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState(false),
    [error, setError] = useState("");
  const notify = (message, error = false) => setNotice({ message, error });
  async function reload() {
    const [s, i, a, t, v, auto] = await Promise.all([
      api("/state"),
      api("/integrations"),
      api("/mail/accounts"),
      api("/tasks"),
      api("/vault"),
      api("/autopilot"),
    ]);
    setData(s);
    setIntegrations(i);
    setAccounts(a.accounts);
    setTasks(t);
    setVault(v);
    setAutopilot(auto);
  }
  async function perform(fn, message) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await reload();
      if (message) notify(message);
    } catch (e) {
      notify(e.message, true);
    } finally {
      setBusy(false);
    }
  }
  const go = (r) => {
    location.hash = r;
    setMobile(false);
  };
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    reload().catch((e) => setError(e.message));
    const listen = () => setRoute(location.hash.slice(1) || "overview");
    window.addEventListener("hashchange", listen);
    const events = new EventSource('/api/events');
    let refreshTimer;
    events.addEventListener('ready', () => reloadRef.current().catch(() => {}));
    events.addEventListener('task', (event) => {
      const task = JSON.parse(event.data);
      if (['completed', 'failed', 'unknown', 'cancelled'].includes(task.status))
        notify(`${task.kind}: ${task.status}`, ['failed', 'unknown'].includes(task.status));
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => reloadRef.current().catch(() => {}), 150);
    });
    events.addEventListener('autopilot', (event) => {
      const item = JSON.parse(event.data);
      notify(item.message, item.kind === 'blocked');
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => reloadRef.current().catch(() => {}), 150);
    });
    return () => {
      window.removeEventListener("hashchange", listen);
      events.close();
      clearTimeout(refreshTimer);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 9000);
    return () => clearTimeout(timer);
  }, [notice]);
  if (error && !data)
    return (
      <div className="app-shell-error">
        <h1>Orbit needs a moment.</h1>
        <p>{error}</p>
        <p>Check the API process, then refresh.</p>
      </div>
    );
  if (!data)
    return (
      <div className="loading">
        <span className="logo-word">orbit</span>
        <p>Getting your workspace ready…</p>
      </div>
    );
  const app = {
    data,
    integrations,
    accounts,
    tasks,
    vault,
    autopilot,
    reload,
    go,
    modal,
    setModal,
    notify,
    perform,
    busy,
  };
  const View =
    {
      overview: Overview,
      jobs: Jobs,
      applications: Applications,
      profile: Profile,
      contacts: Contacts,
      outreach: Outreach,
      inbox: Inbox,
      automation: Automation,
      connections: Connections,
    }[route] || Overview;
  return (
    <Context.Provider value={app}>
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </a>
      <div className="layout">
        <aside className={`sidebar${mobile ? " open" : ""}`}>
          <div className="brand">
            <span className="logo-mark">◉</span>
            <span className="logo-word">orbit</span>
            <small>v0.3</small>
          </div>
          <div className="workspace-switch">
            <span className="workspace-mark">O</span>
            <div>
              Career workspace
              <p className="muted tiny">
                {data.isDemo ? "Fictional sample data" : "Personal workspace"}
              </p>
            </div>
          </div>
          <div className="nav-scroll">
            <p className="nav-label">WORKSPACE</p>
            <nav className="nav" aria-label="Workspace">
              {[
                "overview",
                "profile",
                "jobs",
                "applications",
                "contacts",
                "outreach",
                "inbox",
                "automation",
              ].map((key) => (
                <button
                  key={key}
                  className={`nav-item${route === key ? " active" : ""}`}
                  onClick={() => go(key)}
                  aria-current={route === key ? "page" : undefined}
                >
                  <span>{symbols[key]}</span>
                  {names[key]}
                  {key === "automation" &&
                    tasks.tasks.some(
                      (t) => t.status === "queued" || t.status === "running",
                    ) && (
                      <span className="nav-count">
                        {
                          tasks.tasks.filter((t) =>
                            ["queued", "running"].includes(t.status),
                          ).length
                        }
                      </span>
                    )}
                </button>
              ))}
            </nav>
            <div className="sidebar-section">
              <button
                className={`nav-item${route === "connections" ? " active" : ""}`}
                onClick={() => go("connections")}
              >
                <span>⌘</span>Connections
              </button>
            </div>
          </div>
          <div className="sidebar-spacer" />
          <div className="help-box">
            <strong>A little closer, every day.</strong>
            <p>
              Keep your applications, next steps, and outreach together.
            </p>
            <Button small onClick={() => setModal({ type: "add-job" })}>
              + Add an opportunity
            </Button>
          </div>
          <div className="profile-mini">
            <span className="avatar">
              {data.profile.name
                ?.split(" ")
                .map((x) => x[0])
                .slice(0, 2)
                .join("") || "YOU"}
            </span>
            <button onClick={() => go("profile")}>
              <strong>
                {data.profile.name || "Make this workspace yours"}
              </strong>
              <small>
                {accounts.length ? "Mailbox connected" : "Personal workspace"}
              </small>
            </button>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div className="flex">
              <button
                className="icon-button mobile-only"
                onClick={() => setMobile(!mobile)}
                aria-label="Toggle navigation"
              >
                ☰
              </button>
              <span className="crumb">
                Workspace <span>›</span>
                <strong>{names[route] || "Overview"}</strong>
              </span>
            </div>
            <div className="topbar-actions">
              <span className="muted">
                {new Date().toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </span>
              <Button small onClick={() => go("automation")}>
                {busy ? "Working…" : "View activity"}
              </Button>
            </div>
          </header>
          <main id="main" tabIndex={-1}>
            {data.isDemo && (
              <div className="banner">
                <span>
                  <strong>Sample workspace.</strong> Jobs, contacts, and events
                  are fictional.
                </span>
                <button
                  onClick={() => setModal({ type: "reset", demo: false })}
                >
                  Start my workspace →
                </button>
              </div>
            )}
            <View key={route} />
            <footer className="page-footer">
              Orbit v0.4 · Personal workspace
            </footer>
          </main>
        </div>
      </div>
      {modal && <ModalContent modal={modal} close={() => setModal(null)} />}
      {notice && (
        <div
          className={`notification${notice.error ? " error" : ""}`}
          role="status"
        >
          {notice.message}
          <button
            onClick={() => setNotice(null)}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      )}
    </Context.Provider>
  );
}
export { WorkspaceContext, stages, api } from './shared/workspace.jsx';
export { Button, Badge, Heading } from './shared/ui.jsx';
export { Overview, Jobs, Applications, Profile, Contacts, Outreach, Inbox, Automation, Connections };
