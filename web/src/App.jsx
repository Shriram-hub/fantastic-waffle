import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
const Context = createContext(null),
  useApp = () => useContext(Context);
export const stages = [
  "Saved",
  "Ready",
  "Applied",
  "Assessment",
  "Interview",
  "Interview scheduled",
  "Offer",
  "Rejected",
  "Withdrawn",
];
const split = (s) =>
    String(s || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  fmt = (value) =>
    value
      ? new Date(value).toLocaleString(undefined, {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";
export async function api(
  path,
  data,
  method = data === undefined ? "GET" : "POST",
) {
  const r = await fetch(`/api${path}`, {
    method,
    ...(data === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }),
  });
  const response = await r.json();
  if (!r.ok) throw Error(response.error || "Request failed.");
  return response;
}
const symbols = {
  overview: "◈",
  jobs: "⌕",
  applications: "▤",
  contacts: "♧",
  outreach: "↗",
  inbox: "✉",
  profile: "◎",
  connections: "⌘",
  automation: "≋",
};
const names = {
  overview: "Overview",
  profile: "Profile & résumé vault",
  jobs: "Job feed",
  applications: "Application tracker",
  contacts: "Company contacts",
  outreach: "Outreach studio",
  inbox: "Inbox updates",
  automation: "Automation queue",
  connections: "Connections",
};
export function Button({
  children,
  onClick,
  type = "button",
  primary = false,
  small = false,
  disabled = false,
  ...rest
}) {
  return (
    <button
      type={type}
      className={`btn${primary ? " primary" : ""}${small ? " small" : ""}`}
      onClick={onClick}
      disabled={disabled}
      {...rest}
    >
      {children}
    </button>
  );
}
export function Badge({ value }) {
  return <span className={`badge ${value}`}>{value}</span>;
}
const Sample = ({ value }) =>
  value ? <span className="badge sample">SAMPLE</span> : null;
export function Heading({ title, subtitle, children }) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="btn-row">{children}</div>
    </div>
  );
}
function Empty({ title, children }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Panel({ title, subtitle, children, action }) {
  return (
    <section className="panel page-section">
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function Field({ label, children, hint }) {
  return (
    <label className="field">
      {label}
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Company({ name }) {
  return <span className="company-mark">{name?.[0] || "O"}</span>;
}
function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    el.showModal();
    const cancel = (e) => {
      e.preventDefault();
      onClose();
    };
    el.addEventListener("cancel", cancel);
    return () => el.removeEventListener("cancel", cancel);
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "wide" : ""}
      onClick={(e) => {
        if (e.target === ref.current) {
          const rect = ref.current.getBoundingClientRect();
          if (
            e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          ×
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
function ConfirmAction({ label, explanation, onConfirm, primary = false }) {
  const { perform } = useApp();
  return (
    <Button
      primary={primary}
      onClick={() => {
        if (window.confirm(explanation)) perform(onConfirm);
      }}
    >
      {label}
    </Button>
  );
}
export default function App() {
  const [data, setData] = useState(null),
    [integrations, setIntegrations] = useState({}),
    [accounts, setAccounts] = useState([]),
    [tasks, setTasks] = useState({ tasks: [], applications: [] }),
    [vault, setVault] = useState({ versions: [], links: [] }),
    [route, setRoute] = useState(location.hash.slice(1) || "overview"),
    [modal, setModal] = useState(null),
    [notice, setNotice] = useState(null),
    [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState(false),
    [error, setError] = useState("");
  const notify = (message, error = false) => setNotice({ message, error });
  async function reload() {
    const [s, i, a, t, v] = await Promise.all([
      api("/state"),
      api("/integrations"),
      api("/mail/accounts"),
      api("/tasks"),
      api("/vault"),
    ]);
    setData(s);
    setIntegrations(i);
    setAccounts(a.accounts);
    setTasks(t);
    setVault(v);
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
  useEffect(() => {
    reload().catch((e) => setError(e.message));
    const listen = () => setRoute(location.hash.slice(1) || "overview");
    window.addEventListener("hashchange", listen);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") reload().catch(() => {});
    }, 5000);
    return () => {
      window.removeEventListener("hashchange", listen);
      clearInterval(timer);
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
            <small>v0.2</small>
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
              Background tasks keep working while you focus on your next move.
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
              Orbit v0.2 · Personal workspace · Background worker required for
              queued tasks
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
function Overview() {
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
function ApplicationList({ list }) {
  const { data, setModal } = useApp();
  return list.length ? (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>ROLE & COMPANY</th>
            <th>STAGE</th>
            <th>UPDATED</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((a) => {
            const j = data.jobs.find((j) => j.id === a.jobId);
            return (
              <tr key={a.id}>
                <td>
                  <div className="flex">
                    <Company name={j?.company} />
                    <div>
                      <strong>{j?.title}</strong>
                      <span className="muted">
                        {j?.company} <Sample value={j?.isDemo} />
                      </span>
                    </div>
                  </div>
                </td>
                <td>
                  <Badge value={a.stage} />
                </td>
                <td>{fmt(a.updatedAt)}</td>
                <td>
                  <Button
                    small
                    onClick={() => setModal({ type: "application", id: a.id })}
                  >
                    View
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty title="Your first opportunity is waiting.">
      Save a job or add an application to get started.
    </Empty>
  );
}
function Jobs() {
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
function Applications() {
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
function Profile() {
  const { data, vault, perform, notify, setModal } = useApp(),
    [draft, setDraft] = useState({
      ...data.profile,
      skills: data.profile.skills.join(", "),
      interests: data.profile.interests.join(", "),
    }),
    [qa, setQa] = useState(data.settings.qaBank || []),
    r = data.resume;
  const change = (key, value) => setDraft((v) => ({ ...v, [key]: value }));
  async function upload(file) {
    if (!file) return;
    if (file.size > 5000000) throw Error("Choose a file under 5 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let raw = "";
    for (const b of bytes) raw += String.fromCharCode(b);
    await api("/resume", { name: file.name, base64: btoa(raw) });
    notify("Résumé saved. Text extraction is queued for the worker.");
  }
  return (
    <>
      <Heading
        title="The story only you can tell."
        subtitle="A reusable profile, a résumé vault, and answers you have approved."
      />
      <div className="profile-grid">
        <div>
          <form
            className="form-section"
            onSubmit={(e) => {
              e.preventDefault();
              perform(async () => {
                await api(
                  "/profile",
                  {
                    ...draft,
                    skills: split(draft.skills),
                    interests: split(draft.interests),
                  },
                  "PUT",
                );
                notify("Profile saved.");
              });
            }}
          >
            <h2>A little about you</h2>
            <p>
              Saved details are used for application packets and reviewed form
              filling.
            </p>
            <div className="form-grid">
              {[
                ["name", "Full name", "text"],
                ["email", "Email", "email"],
                ["phone", "Phone", "tel"],
                ["location", "Location", "text"],
                ["headline", "Professional headline", "text"],
                ["portfolio", "Portfolio", "url"],
                ["linkedin", "LinkedIn URL", "url"],
                ["github", "GitHub URL", "url"],
                ["noticePeriod", "Notice period", "text"],
                ["expectedSalary", "Expected salary / CTC", "text"],
                ["authorization", "Work authorization notes", "text"],
                ["skills", "Skills, separated by commas", "text"],
                [
                  "interests",
                  "Target roles or fields, separated by commas",
                  "text",
                ],
              ].map(([key, label, type]) => (
                <Field label={label} key={key}>
                  <input
                    className="input"
                    type={type}
                    value={draft[key] || ""}
                    onChange={(e) => change(key, e.target.value)}
                  />
                </Field>
              ))}
              <Field label="Work preference">
                <select
                  value={draft.workMode}
                  onChange={(e) => change("workMode", e.target.value)}
                >
                  {["Any", "Remote", "Hybrid", "On-site"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Your story">
                <textarea
                  rows="5"
                  value={draft.summary || ""}
                  onChange={(e) => change("summary", e.target.value)}
                />
              </Field>
            </div>
            <div className="form-actions">
              <Button primary type="submit">
                Save my profile
              </Button>
            </div>
          </form>
          <section className="form-section">
            <h2>Your approved answer bank</h2>
            <p>
              Exact question labels and answers for browser-assisted forms.
              Unknown eligibility or screening questions stay empty.
            </p>
            {qa.map((pair, i) => (
              <div className="qapair" key={i}>
                <input
                  className="input"
                  aria-label={`Question ${i + 1}`}
                  placeholder="Exact question label"
                  value={pair.question}
                  onChange={(e) =>
                    setQa(
                      qa.map((p, n) =>
                        n === i ? { ...p, question: e.target.value } : p,
                      ),
                    )
                  }
                />
                <input
                  className="input"
                  aria-label={`Answer ${i + 1}`}
                  placeholder="Your approved answer"
                  value={pair.answer}
                  onChange={(e) =>
                    setQa(
                      qa.map((p, n) =>
                        n === i ? { ...p, answer: e.target.value } : p,
                      ),
                    )
                  }
                />
                <button
                  className="icon-button"
                  onClick={() => setQa(qa.filter((_, n) => n !== i))}
                  aria-label="Remove answer"
                >
                  ×
                </button>
              </div>
            ))}
            <div className="form-actions">
              <Button
                onClick={() => setQa([...qa, { question: "", answer: "" }])}
              >
                + Add answer
              </Button>
              <Button
                primary
                onClick={() =>
                  perform(
                    () =>
                      api("/settings", { ...data.settings, qaBank: qa }, "PUT"),
                    "Answer bank saved.",
                  )
                }
              >
                Save answers
              </Button>
            </div>
          </section>
        </div>
        <div className="profile-side">
          <section className="form-section">
            <h2>Your résumé, ready to go.</h2>
            <p>PDF, DOCX, or TXT · Up to 5 MB</p>
            <label className="dropzone">
              <strong>Choose a résumé</strong>
              <small>Extraction runs in the background.</small>
              <input
                type="file"
                className="sr-only"
                accept=".pdf,.docx,.txt"
                onChange={(e) => perform(() => upload(e.target.files[0]))}
              />
            </label>
            {r && (
              <>
                <div className="file-card">
                  <span>▤</span>
                  <div className="grow">
                    <strong>{r.name}</strong>
                    <p>
                      {Math.ceil(r.size / 1000)} KB ·{" "}
                      {r.parseStatus || "Imported"}
                    </p>
                  </div>
                  <a href="/api/resume/download">Download</a>
                </div>
                {r.warning && <p className="notice">{r.warning}</p>}
                {r.suggestions?.skills?.length > 0 && (
                  <div className="readonly-result">
                    <strong>Detected skills to review</strong>
                    <p>{r.suggestions.skills.join(", ")}</p>
                    <Button
                      small
                      onClick={() =>
                        change(
                          "skills",
                          [
                            ...new Set([
                              ...split(draft.skills),
                              ...r.suggestions.skills,
                            ]),
                          ].join(", "),
                        )
                      }
                    >
                      Add to profile draft
                    </Button>
                  </div>
                )}
                <div className="btn-row mt">
                  <Button
                    small
                    onClick={() => setModal({ type: "resume-text" })}
                  >
                    Review text
                  </Button>
                  <Button small onClick={() => setModal({ type: "extract" })}>
                    Structured AI extraction
                  </Button>
                  <Button small onClick={() => setModal({ type: "share" })}>
                    Create résumé link
                  </Button>
                </div>
                {r.structured && (
                  <div className="mt">
                    <h3 className="secondary-heading">
                      Structured extraction · review before using
                    </h3>
                    <pre className="resume-structured">
                      {JSON.stringify(r.structured, null, 2)}
                    </pre>
                  </div>
                )}
              </>
            )}
          </section>
          <Panel
            title="Tailored versions"
            subtitle="Relevant existing bullets highlighted without inventing experience."
          >
            {vault.versions.length ? (
              vault.versions.map((v) => (
                <div className="resume-version" key={v.id}>
                  <strong>{v.title}</strong>
                  <p>{fmt(v.createdAt)}</p>
                  <a
                    className="btn small"
                    href={`/api/vault/${v.id}/download`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open / save as PDF
                  </a>
                </div>
              ))
            ) : (
              <Empty title="A stronger fit starts with your facts.">
                Choose Tailor on a job to create a printable version for review.
              </Empty>
            )}
          </Panel>
          {data.profile.resumeUrl && (
            <section className="form-section">
              <h2>Your résumé link</h2>
              <p>
                <a
                  href={data.profile.resumeUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open public résumé link ↗
                </a>
              </p>
              <div className="code-box">{data.profile.resumeUrl}</div>
              <p className="hint">
                Expires after seven days or when the original file changes.
                Views can include link scanners.
              </p>
              {vault.links
                .filter((link) => !link.revoked)
                .map((link) => (
                  <div className="spread mt" key={link.id}>
                    <span className="view-count">
                      {link.views} link requests · expires {fmt(link.expires)}
                    </span>
                    <Button
                      small
                      onClick={() =>
                        perform(
                          () => api(`/share/${link.id}/revoke`, {}),
                          "Link revoked.",
                        )
                      }
                    >
                      Revoke
                    </Button>
                  </div>
                ))}
            </section>
          )}
        </div>
      </div>
    </>
  );
}
function Contacts() {
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
function Outreach() {
  const { data, accounts, perform, setModal, notify } = useApp(),
    [draft, setDraft] = useState({
      name: "",
      subject: "Exploring {{my_role}} opportunities at {{company}}",
      body: "Hi {{first_name}},\n\nI’m {{my_name}}, a {{my_role}}. I’m interested in the work your team is doing at {{company}}. My background includes {{skills}}.\n\nYou can find my résumé here: {{resume_url}}\n\nWould you be open to a brief conversation?",
      accountId: "",
      attachResume: false,
      contactIds: [],
      sequence: {
        enabled: false,
        afterBusinessDays: 4,
        body: "Hi {{first_name}}, I wanted to follow up on my earlier note about opportunities at {{company}}. Would it be useful if I shared more context on my background?",
      },
    }),
    [editing, setEditing] = useState(null);
  const update = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  async function save(preview) {
    const result = await api(
      editing ? `/campaigns/${editing}` : "/campaigns",
      draft,
      editing ? "PATCH" : "POST",
    );
    setEditing(result.campaign.id);
    if (preview) setModal({ type: "campaign-preview", id: result.campaign.id });
    else notify("Draft saved.");
  }
  return (
    <>
      <Heading
        title="A thoughtful hello goes further."
        subtitle="Personalize your introduction. Preview every recipient. Send with measured pacing."
      />
      <div className="two-column">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            perform(() => save(true));
          }}
        >
          <section className="form-section">
            <h2>Your next introduction</h2>
            <p>
              Messages are sent individually. Sequences stop on a detected
              reply, suppression, or pause.
            </p>
            <div className="stack">
              <Field label="Campaign name">
                <input
                  className="input"
                  required
                  value={draft.name}
                  onChange={(e) => update("name", e.target.value)}
                />
              </Field>
              <Field label="Send from">
                <select
                  value={draft.accountId}
                  onChange={(e) => update("accountId", e.target.value)}
                >
                  <option value="">Resend / preview mode</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.email} · {a.provider}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Subject">
                <input
                  className="input"
                  required
                  value={draft.subject}
                  onChange={(e) => update("subject", e.target.value)}
                />
              </Field>
              <Field label="Message">
                <textarea
                  className="textarea-lg"
                  required
                  value={draft.body}
                  onChange={(e) => update("body", e.target.value)}
                />
              </Field>
              <p className="compose-help">
                {
                  "{{first_name}} · {{company}} · {{my_name}} · {{my_role}} · {{skills}} · {{resume_url}} · {{icebreaker}}"
                }
              </p>
              <label className="checkbox-group">
                <input
                  type="checkbox"
                  checked={draft.attachResume}
                  onChange={(e) => update("attachResume", e.target.checked)}
                />
                Attach my uploaded résumé
              </label>
              <label className="checkbox-group">
                <input
                  type="checkbox"
                  checked={draft.sequence.enabled}
                  onChange={(e) =>
                    update("sequence", {
                      ...draft.sequence,
                      enabled: e.target.checked,
                    })
                  }
                />
                Add one approved follow-up after four business days
              </label>
              {draft.sequence.enabled && (
                <Field
                  label="Follow-up message"
                  hint="A connected mailbox and a fresh inbox sync are required. The provider’s thread is reused."
                >
                  <textarea
                    value={draft.sequence.body}
                    onChange={(e) =>
                      update("sequence", {
                        ...draft.sequence,
                        body: e.target.value,
                      })
                    }
                  />
                </Field>
              )}
            </div>
          </section>
          <section className="form-section">
            <div className="spread mb">
              <h2>Who would you like to reach?</h2>
              <span className="small muted">
                {draft.contactIds.length} selected
              </span>
            </div>
            <div className="contact-list">
              {data.contacts
                .filter((c) => !c.suppressed)
                .map((c) => (
                  <label className="contact-row" key={c.id}>
                    <input
                      type="checkbox"
                      checked={draft.contactIds.includes(c.id)}
                      onChange={(e) =>
                        update(
                          "contactIds",
                          e.target.checked
                            ? [...draft.contactIds, c.id]
                            : draft.contactIds.filter((id) => id !== c.id),
                        )
                      }
                    />
                    <div className="grow">
                      <strong>
                        {c.name} · {c.company}
                      </strong>
                      <p>{c.email || "Email enrichment needed"}</p>
                    </div>
                    <Sample value={c.isDemo} />
                    <Badge value={c.emailStatus} />
                  </label>
                ))}
            </div>
            <div className="form-actions">
              <Button onClick={() => perform(() => save(false))}>
                Save draft
              </Button>
              <Button primary type="submit">
                Review campaign
              </Button>
            </div>
          </section>
        </form>
        <div>
          <section className="form-section">
            <h2>Measured sending, clear results.</h2>
            <p>
              Default cap: 30 messages per account per UTC day. Pacing spreads
              sends 3–8 minutes apart inside the configured business-hour
              window. These settings do not guarantee inbox placement.
            </p>
            <p className="notice">
              No real messages leave Orbit until the server enables sending and
              you approve the campaign. Unknown provider acceptance is held for
              reconciliation.
            </p>
          </section>
          <Panel title="Your campaigns">
            {data.campaigns.map((c) => (
              <div className="campaign-row" key={c.id}>
                <div className="grow">
                  <h3>{c.name}</h3>
                  <p>
                    {c.contactIds.length} recipients · {c.status}
                  </p>
                </div>
                {!c.deliveries.length && (
                  <Button
                    small
                    onClick={() => {
                      setDraft({
                        ...c,
                        sequence: c.sequence || {
                          enabled: false,
                          afterBusinessDays: 4,
                          body: "",
                        },
                      });
                      setEditing(c.id);
                    }}
                  >
                    Edit
                  </Button>
                )}
                <Button
                  small
                  onClick={() =>
                    setModal({ type: "campaign-preview", id: c.id })
                  }
                >
                  Review
                </Button>
                {c.deliveries.some((d) => d.status === "queued") && (
                  <Button
                    small
                    onClick={() =>
                      perform(
                        () => api(`/campaigns/${c.id}/pause`, {}),
                        "Campaign paused.",
                      )
                    }
                  >
                    Pause
                  </Button>
                )}
              </div>
            ))}
            {!data.campaigns.length && (
              <Empty title="Your first hello is waiting.">
                Campaign drafts and delivery results will appear here.
              </Empty>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
function Inbox() {
  const { data, accounts, perform, setModal } = useApp();
  return (
    <>
      <Heading
        title="The next step, without the guesswork."
        subtitle="Mailbox events become status suggestions, assessment links, and reviewed actions."
      >
        <Button onClick={() => setModal({ type: "import-email" })}>
          Paste an update
        </Button>
        {accounts.map((a) => (
          <Button
            primary
            key={a.id}
            onClick={() =>
              perform(
                () => api(`/mail/${a.id}/sync`, {}),
                "Mailbox sync queued.",
              )
            }
          >
            Sync {a.provider}
          </Button>
        ))}
      </Heading>
      {!accounts.length && (
        <div className="banner info">
          <span>
            Connect Google or Microsoft in Connections for inbox sync. Pasted
            updates also work.
          </span>
        </div>
      )}
      <Panel
        title="Application updates"
        subtitle="Only unique role matches can transition automatically when you opt in."
      >
        {data.inbox.map((item) => (
          <InboxItem key={item.id} item={item} />
        ))}
        {!data.inbox.length && (
          <Empty title="Room for good news.">
            Import a confirmation, interview invitation, assessment, or decision
            email.
          </Empty>
        )}
      </Panel>
    </>
  );
}
function InboxItem({ item }) {
  const { data, perform } = useApp(),
    [applicationId, setApplication] = useState(item.applicationId || "");
  return (
    <article className="inbox-item">
      <div className="spread">
        <span className="small muted">
          {item.from || "Imported email"} ·{" "}
          {fmt(item.receivedAt || item.createdAt)}
        </span>
        <Badge value={item.status} />
      </div>
      <h3>{item.subject}</h3>
      <p>{item.body.slice(0, 600)}</p>
      {item.deadline && (
        <div className="notice mt">
          Deadline stated in email: <strong>{item.deadline}</strong>
          {item.links?.map((link) => (
            <p key={link}>
              <a href={link} target="_blank" rel="noreferrer">
                Open assessment / action link ↗
              </a>
            </p>
          ))}
        </div>
      )}
      {item.status === "Needs review" && (
        <div className="inline-form mt">
          <Field
            label={item.ambiguous ? "Choose the correct role" : "Application"}
          >
            <select
              value={applicationId}
              onChange={(e) => setApplication(e.target.value)}
            >
              <option value="">Choose an application</option>
              {data.applications.map((a) => {
                const j = data.jobs.find((j) => j.id === a.jobId);
                return (
                  <option key={a.id} value={a.id}>
                    {j?.company} · {j?.title}
                  </option>
                );
              })}
            </select>
          </Field>
          <Badge value={item.proposedStage || "No status detected"} />
          <Button
            small
            disabled={!applicationId || !item.proposedStage}
            primary
            onClick={() =>
              perform(
                () => api(`/inbox/${item.id}/accept`, { applicationId }),
                "Tracker updated from reviewed email.",
              )
            }
          >
            Apply suggestion
          </Button>
          <Button
            small
            onClick={() => perform(() => api(`/inbox/${item.id}/dismiss`, {}))}
          >
            Dismiss
          </Button>
        </div>
      )}
    </article>
  );
}
function Automation() {
  const { tasks, data, perform, setModal } = useApp();
  return (
    <>
      <Heading
        title="Work in motion."
        subtitle="Background imports, parsing, matching, outreach, and browser-assisted applications."
      />
      <Panel
        title="Browser application queue"
        subtitle="The extension fills supported fields. You review and submit yourself."
      >
        {tasks.applications.map((t) => {
          const a = data.applications.find((a) => a.id === t.application_id),
            j = a && data.jobs.find((j) => j.id === a.jobId);
          return (
            <div className="task-item" key={t.id}>
              <div className="spread">
                <strong>
                  {j?.company} · {j?.title}
                </strong>
                <Badge value={t.status} />
              </div>
              {t.details.report?.missing?.length > 0 && (
                <p>Needs attention: {t.details.report.missing.join(" · ")}</p>
              )}
              {t.status !== "confirmed" && (
                <div className="btn-row mt">
                  {["blocked", "needs-review"].includes(t.status) && (
                    <Button
                      small
                      onClick={() =>
                        perform(
                          () => api(`/apply/${t.id}/requeue`, {}),
                          "Application requeued for the extension.",
                        )
                      }
                    >
                      Queue fill again
                    </Button>
                  )}
                  <Button
                    small
                    onClick={() =>
                      setModal({ type: "confirm-application", id: t.id })
                    }
                  >
                    Record employer confirmation
                  </Button>
                </div>
              )}
            </div>
          );
        })}
        {!tasks.applications.length && (
          <Empty title="A little less form filling.">
            Select jobs in the feed and choose Browser-assisted fill. Pair the
            extension in Connections.
          </Empty>
        )}
      </Panel>
      <Panel
        title="Background tasks"
        subtitle="Queued tasks require npm run worker or the Docker worker service."
      >
        {tasks.tasks.map((t) => (
          <div className="task-item" key={t.id}>
            <div className="spread">
              <div>
                <strong>{t.kind}</strong>
                <p>
                  Scheduled {fmt(t.run_at)} · Attempts {t.attempts}/
                  {t.max_attempts}
                </p>
              </div>
              <Badge value={t.status} />
            </div>
            {t.error && <p className="task-error">{t.error}</p>}
            <div className="btn-row mt">
              <Button
                small
                onClick={() => setModal({ type: "task-logs", id: t.id })}
              >
                View logs
              </Button>
              {t.status === "queued" && (
                <Button
                  small
                  onClick={() =>
                    perform(() => api(`/tasks/${t.id}/cancel`, {}))
                  }
                >
                  Cancel
                </Button>
              )}
              {t.status === "failed" && !t.kind.startsWith("campaign.") && (
                <Button
                  small
                  onClick={() => perform(() => api(`/tasks/${t.id}/retry`, {}))}
                >
                  Retry
                </Button>
              )}
            </div>
          </div>
        ))}
        {!tasks.tasks.length && (
          <Empty title="Ready when you are.">
            Imports, matching, parsing, and email jobs will appear here.
          </Empty>
        )}
      </Panel>
    </>
  );
}
function Connections() {
  const { data, accounts, integrations, perform, notify, setModal } = useApp(),
    [settings, setSettings] = useState({
      ...data.settings,
      greenhouseBoards: (data.settings.greenhouseBoards || []).join(", "),
      leverBoards: (data.settings.leverBoards || []).join(", "),
      ashbyBoards: (data.settings.ashbyBoards || []).join(", "),
      sendTimeZone: data.settings.sendTimeZone || "UTC",
      dailySendLimit: data.settings.dailySendLimit || 30,
    });
  const update = (k, v) => setSettings((s) => ({ ...s, [k]: v }));
  return (
    <>
      <Heading
        title="Your tools, working together."
        subtitle="Explicit connections. Server-side secrets. A clear view of what is configured."
      />
      <div className="provider-grid">
        <section className="connection-card">
          <div className="spread">
            <span className="provider-mark">G</span>
            <Badge
              value={
                accounts.some((a) => a.provider === "google")
                  ? "Connected"
                  : integrations.googleOAuth
                    ? "Ready to connect"
                    : "Needs server setup"
              }
            />
          </div>
          <h3>Google / Gmail</h3>
          <p>
            Read application updates, watch mailbox history through Pub/Sub, and
            send reviewed messages from your account.
          </p>
          <a className="btn small" href="/api/oauth/google/start">
            Connect Google
          </a>
        </section>
        <section className="connection-card">
          <div className="spread">
            <span className="provider-mark blue">M</span>
            <Badge
              value={
                accounts.some((a) => a.provider === "microsoft")
                  ? "Connected"
                  : integrations.microsoftOAuth
                    ? "Ready to connect"
                    : "Needs server setup"
              }
            />
          </div>
          <h3>Microsoft / Outlook</h3>
          <p>
            Use Graph delta sync and authenticated webhook notifications. Tokens
            are encrypted on the server.
          </p>
          <a className="btn small" href="/api/oauth/microsoft/start">
            Connect Microsoft
          </a>
        </section>
        {[
          ["Apollo", "Contact search & selected enrichment", "apollo"],
          ["Hunter", "Work-email verification", "hunter"],
          ["Adzuna", "Aggregator search using your target roles", "adzuna"],
          [
            "AI & embeddings",
            "Structured extraction and semantic matching",
            "ai",
          ],
        ].map(([name, description, key]) => (
          <section className="connection-card" key={key}>
            <div className="spread">
              <span className="provider-mark">{name[0]}</span>
              <Badge
                value={
                  integrations[key] ? "Key configured" : "Needs server key"
                }
              />
            </div>
            <h3>{name}</h3>
            <p>{description}. Keys belong in the server environment.</p>
          </section>
        ))}
      </div>
      <div className="content-grid mt">
        <form
          className="form-section"
          onSubmit={(e) => {
            e.preventDefault();
            perform(
              () =>
                api(
                  "/settings",
                  {
                    ...settings,
                    greenhouseBoards: split(settings.greenhouseBoards),
                    leverBoards: split(settings.leverBoards),
                    ashbyBoards: split(settings.ashbyBoards),
                  },
                  "PUT",
                ),
              "Settings saved.",
            );
          }}
        >
          <h2>Sources & automation settings</h2>
          <p>
            Remotive and Arbeitnow are public feeds. Company-board slugs choose
            specific employers.
          </p>
          <div className="stack">
            {["greenhouse", "lever", "ashby"].map((source) => (
              <Field
                key={source}
                label={`${source[0].toUpperCase() + source.slice(1)} company slugs`}
                hint="Comma-separated; up to ten."
              >
                <input
                  className="input"
                  value={settings[`${source}Boards`]}
                  onChange={(e) => update(`${source}Boards`, e.target.value)}
                />
              </Field>
            ))}
            <Field
              label="Sending time zone (IANA)"
              hint="This is the campaign window’s time zone. Default UTC; no recipient location is guessed."
            >
              <input
                className="input"
                value={settings.sendTimeZone}
                onChange={(e) => update("sendTimeZone", e.target.value)}
              />
            </Field>
            <Field label="Daily send cap per account (1–50)">
              <input
                className="input"
                type="number"
                min="1"
                max="50"
                value={settings.dailySendLimit}
                onChange={(e) =>
                  update("dailySendLimit", Number(e.target.value))
                }
              />
            </Field>
            <label className="checkbox-group">
              <input
                type="checkbox"
                checked={settings.inboxAutoUpdate || false}
                onChange={(e) => update("inboxAutoUpdate", e.target.checked)}
              />
              Automatically advance uniquely matched inbox updates
            </label>
            <p className="hint">
              Ambiguous, older, regressive, and terminal-stage changes remain in
              review.
            </p>
            <label className="checkbox-group">
              <input
                type="checkbox"
                checked={settings.inboxUseAI || false}
                onChange={(e) => update("inboxUseAI", e.target.checked)}
              />
              Use the configured model for email classification
            </label>
            <p className="hint">
              If enabled, matched email content is sent to your model provider
              and may incur API usage charges.
            </p>
          </div>
          <div className="form-actions">
            <Button primary type="submit">
              Save settings
            </Button>
          </div>
        </form>
        <div>
          <Panel title="Connected mailboxes">
            {accounts.map((a) => (
              <div className="task-item" key={a.id}>
                <strong>{a.email}</strong>
                <p>
                  {a.provider} · Last sync {fmt(a.lastSync)}
                  <br />
                  Watch expires {fmt(a.watchExpires)}
                </p>
                <div className="btn-row mt">
                  <Button
                    small
                    onClick={() =>
                      perform(
                        () => api(`/mail/${a.id}/sync`, {}),
                        "Sync queued.",
                      )
                    }
                  >
                    Sync
                  </Button>
                  <Button
                    small
                    onClick={() =>
                      perform(
                        () => api(`/mail/${a.id}/watch`, {}),
                        "Watch setup / renewal queued.",
                      )
                    }
                  >
                    Enable push watch
                  </Button>
                  <Button
                    small
                    onClick={() =>
                      perform(
                        () => api(`/mail/${a.id}/disconnect`, {}),
                        "Mailbox disconnected.",
                      )
                    }
                  >
                    Disconnect
                  </Button>
                </div>
              </div>
            ))}
            {!accounts.length && (
              <Empty title="Bring your inbox into view.">
                OAuth setup requires server credentials and registered callback
                URLs.
              </Empty>
            )}
          </Panel>
          <section className="form-section">
            <h2>Browser application assistant</h2>
            <p>
              Load the repository’s extension folder as an unpacked Chrome
              extension. Generate a token, then pair it with this Orbit address.
              Tokens expire in 24 hours.
            </p>
            <div className="btn-row">
              <Button
                onClick={() =>
                  perform(async () => {
                    const result = await api("/extension/token", {});
                    setModal({ type: "token", token: result.token });
                  })
                }
              >
                Generate pairing token
              </Button>
              <Button
                onClick={() =>
                  perform(
                    () => api("/extension/token", {}, "DELETE"),
                    "Extension tokens revoked.",
                  )
                }
              >
                Revoke tokens
              </Button>
            </div>
          </section>
          <section className="form-section">
            <h2>Workspace controls</h2>
            <p>
              Reset replaces profile, files, records, queued tasks, and mailbox
              connections.
            </p>
            <div className="btn-row">
              <Button onClick={() => setModal({ type: "reset", demo: false })}>
                Start fresh
              </Button>
              <Button onClick={() => setModal({ type: "reset", demo: true })}>
                Load sample workspace
              </Button>
            </div>
          </section>
        </div>
      </div>
      <div className="notice">
        Queue driver: {integrations.queueDriver}. PostgreSQL/pgvector and
        multi-user sign-in are deployment milestones; this running version uses
        relational SQLite and a personal workspace. OAuth mailbox authorization
        does not create separate application user accounts.
      </div>
    </>
  );
}
function ModalContent({ modal, close }) {
  const { data, perform, notify, go } = useApp(),
    [textValue, setText] = useState(""),
    [result, setResult] = useState(null);
  useEffect(() => {
    if (modal.type === "task-logs")
      api(`/tasks/${modal.id}/logs`)
        .then(setResult)
        .catch((e) => notify(e.message, true));
  }, [modal.id, modal.type]);
  if (modal.type === "campaign-preview")
    return <CampaignPreview id={modal.id} close={close} />;
  if (modal.type === "apollo") return <ApolloModal close={close} />;
  if (modal.type === "job") {
    const j = data.jobs.find((j) => j.id === modal.id);
    return (
      <Modal title="A closer look" onClose={close}>
        <div className="spread">
          <Company name={j.company} />
          <Sample value={j.isDemo} />
        </div>
        <h2 className="detail-title">{j.title}</h2>
        <p className="detail-company">
          {j.company} · {j.location}
        </p>
        <div className="match-card">
          <strong>{j.match.score ?? "—"}% keyword profile match</strong>
          <ul>
            {j.match.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {j.semanticMatch && (
            <p>
              Semantic: {j.semanticMatch.score}% · {j.semanticMatch.model}
            </p>
          )}
        </div>
        <p className="detail-description">{j.description}</p>
        <div className="app-detail-links">
          {j.url && (
            <a className="btn" href={j.url} target="_blank" rel="noreferrer">
              Open original listing ↗
            </a>
          )}
          <Button
            onClick={() =>
              perform(
                () => api("/tailor", { jobId: j.id }),
                "Fact-preserving résumé version queued.",
              )
            }
          >
            Tailor résumé
          </Button>
          <Button
            primary
            onClick={() =>
              perform(async () => {
                await api("/applications/batch", { jobIds: [j.id] });
                close();
                go("applications");
              })
            }
          >
            Prepare application
          </Button>
        </div>
        <p className="hint">
          Original requirements and eligibility always take precedence over a
          score.
        </p>
      </Modal>
    );
  }
  if (modal.type === "application")
    return <ApplicationModal id={modal.id} close={close} />;
  if (modal.type === "add-job") return <AddJobModal close={close} />;
  if (modal.type === "add-contact")
    return (
      <SimpleFormModal
        title="A new connection"
        fields={["name", "email", "company", "title"]}
        submit={(v) => api("/contacts", v)}
        close={close}
      />
    );
  if (modal.type === "import-email") return <ImportEmailModal close={close} />;
  if (modal.type === "import-contacts")
    return (
      <Modal title="Bring your contacts with you" onClose={close}>
        <p className="small muted">
          Up to 500 rows. Columns: name, email, company, title, email_status.
        </p>
        <form
          className="stack mt"
          onSubmit={(e) => {
            e.preventDefault();
            perform(async () => {
              const r = await api("/contacts/import", { csv: textValue });
              setResult(r);
            });
          }}
        >
          <input
            className="input"
            aria-label="CSV file"
            type="file"
            accept=".csv"
            onChange={async (e) => {
              const file = e.target.files[0];
              if (!file) return;
              if (file.size > 2000000)
                return notify("Choose a CSV under 2 MB.", true);
              setText(await file.text());
            }}
          />
          <textarea
            aria-label="CSV text"
            rows="9"
            value={textValue}
            onChange={(e) => setText(e.target.value)}
            placeholder="name,email,company,title,email_status"
          />
          <Button primary type="submit">
            Import contacts
          </Button>
        </form>
        {result && (
          <div className="readonly-result mt">
            {result.imported} imported · {result.skipped} skipped
            <br />
            {result.errors?.join("\n")}
          </div>
        )}
      </Modal>
    );
  if (modal.type === "personalize")
    return (
      <Modal title="A factual opening line" onClose={close}>
        <p className="small muted">
          The worker will send this contact’s role/company context and the
          selected job description to your model provider. It may incur API
          charges. Review the generated opener and its exact source quote before
          using it.
        </p>
        <form
          className="stack mt"
          onSubmit={(e) => {
            e.preventDefault();
            const v = Object.fromEntries(new FormData(e.currentTarget));
            perform(async () => {
              await api(`/contacts/${modal.id}/personalize`, {
                confirmed: true,
                jobId: v.jobId || null,
              });
              close();
            });
          }}
        >
          <Field label="Relevant role (optional)">
            <select name="jobId">
              <option value="">Contact context only</option>
              {data.jobs
                .filter((j) => !j.isDemo)
                .slice(0, 100)
                .map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.company} · {j.title}
                  </option>
                ))}
            </select>
          </Field>
          <Button primary type="submit">
            Queue an opener
          </Button>
        </form>
      </Modal>
    );
  if (modal.type === "resume-text")
    return (
      <TextEditor
        title="Review extracted résumé text"
        initial={data.resume?.text || ""}
        submit={(value) => api("/resume/text", { text: value }, "PUT")}
        close={close}
      />
    );
  if (modal.type === "confirm-application")
    return (
      <TextEditor
        title="Record the employer’s confirmation"
        label="Confirmation reference / receipt"
        initial=""
        submit={(value) =>
          api(`/apply/${modal.id}/confirm`, { confirmationReference: value })
        }
        close={close}
      />
    );
  if (modal.type === "task-logs")
    return (
      <Modal title="Task activity" onClose={close}>
        <div className="timeline">
          {result?.logs?.map((l, i) => (
            <div className="timeline-item" key={i}>
              <strong>{fmt(l.at)}</strong>
              <p>{l.message}</p>
            </div>
          )) || "Loading…"}
        </div>
      </Modal>
    );
  if (modal.type === "token")
    return (
      <Modal title="Pair your browser assistant" onClose={close}>
        <p className="small muted">
          Copy this token into the extension popup. It grants access to queued
          application profiles and the résumé; keep it private. It expires in 24
          hours.
        </p>
        <pre className="code-box mt">{modal.token}</pre>
        <p className="hint">
          The token is shown only in this response. Revoke it from Connections
          when finished.
        </p>
      </Modal>
    );
  const descriptions = {
    reset: `This replaces your current profile, résumé, jobs, applications, contacts, campaigns, mailbox connections, and queued tasks${modal.demo ? " with fictional sample data" : ""}. Export your applications first if needed.`,
    extract:
      "The worker will send your résumé text to the configured model provider for structured extraction. This may incur API usage charges. Review every extracted value before using it.",
    share:
      "This creates a public, unlisted link to your uploaded résumé for seven days. Anyone with the link can view it. Link requests may include automated scanners; they do not prove a recruiter read the document.",
    embeddings: `The worker will send your résumé text and ${modal.ids?.length} selected job descriptions to the configured embedding provider. This may incur API usage charges.`,
    enrich:
      "Apollo may charge credits for this work-email enrichment lookup. Exact costs depend on your plan. Personal emails and phone numbers are not requested.",
    verify:
      "Hunter may charge credits to verify this contact’s work email. Catch-all, invalid, and unknown results remain blocked from sending.",
    "browser-batch": `${modal.ids?.length} selected opportunities will be queued for your paired Chrome extension. It fills recognized fields and your approved answers, then stops for review. It does not solve verification challenges or submit an application.`,
  };
  const action = async () => {
    if (modal.type === "reset") {
      await api("/workspace/reset", {
        confirm: modal.demo ? "LOAD_DEMO" : "START_FRESH",
      });
      go(modal.demo ? "overview" : "profile");
    }
    if (modal.type === "extract") await api("/ai/extract", { confirmed: true });
    if (modal.type === "share") {
      const r = await api("/share/resume", { approved: true });
      notify(r.url);
    }
    if (modal.type === "embeddings")
      await api("/matching", { confirmed: true, jobIds: modal.ids });
    if (modal.type === "enrich")
      await api(`/contacts/${modal.id}/enrich`, { confirmCredits: true });
    if (modal.type === "verify")
      await api(`/contacts/${modal.id}/verify`, { confirmed: true });
    if (modal.type === "browser-batch")
      await api("/apply/queue", { approved: true, jobIds: modal.ids });
    close();
  };
  return (
    <Modal
      title={
        modal.type === "reset" ? "Start a new chapter?" : "Review this action"
      }
      onClose={close}
    >
      <p className="pre">{descriptions[modal.type]}</p>
      <div className="form-actions">
        <Button onClick={close}>Cancel</Button>
        <Button primary onClick={() => perform(action)}>
          Confirm
        </Button>
      </div>
    </Modal>
  );
}
function TextEditor({ title, label = "Text", initial, submit, close }) {
  const { perform } = useApp(),
    [value, setValue] = useState(initial);
  return (
    <Modal title={title} onClose={close} wide>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          perform(async () => {
            await submit(value);
            close();
          });
        }}
      >
        <Field label={label}>
          <textarea
            rows="15"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        <div className="form-actions">
          <Button primary type="submit">
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function SimpleFormModal({ title, fields, submit, close }) {
  const { perform } = useApp();
  return (
    <Modal title={title} onClose={close}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const values = Object.fromEntries(new FormData(e.currentTarget));
          perform(async () => {
            await submit(values);
            close();
          });
        }}
      >
        {fields.map((name) => (
          <Field key={name} label={name[0].toUpperCase() + name.slice(1)}>
            <input
              className="input"
              type={name === "email" ? "email" : "text"}
              required
              name={name}
            />
          </Field>
        ))}
        <div className="form-actions">
          <Button primary type="submit">
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function AddJobModal({ close }) {
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
function ApplicationModal({ id, close }) {
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
function ImportEmailModal({ close }) {
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
function ApolloModal({ close }) {
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
function CampaignPreview({ id, close }) {
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
                ? ` + up to ${preview.messages.length} follow-ups`
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
                Attachment: {preview.attachment.name}
              </div>
            )}
          </div>
          {preview.sequence?.enabled && (
            <div className="notice mt">
              <strong>
                Approved follow-up after {preview.sequence.afterBusinessDays}{" "}
                business days
              </strong>
              <p className="pre">
                {preview.followupMessages?.[index]?.body ||
                  preview.sequence.body}
              </p>
              <p className="hint">
                Stopped by a detected reply, suppression, pause, content
                changes, or a stale inbox sync.
              </p>
            </div>
          )}
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
                  {d.followupStatus && (
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

export {
  Context as WorkspaceContext,
  Overview,
  Jobs,
  Applications,
  Profile,
  Contacts,
  Outreach,
  Inbox,
  Automation,
  Connections,
};
