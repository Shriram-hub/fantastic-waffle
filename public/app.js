const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const h = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  search: '<circle cx="10.8" cy="10.8" r="7.2"/><path d="m16 16 4.5 4.5"/>',
  briefcase:
    '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V4h8v3M3 12c5 4 13 4 18 0M12 12v4"/>',
  people:
    '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-4-5"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z M22 2 11 13"/>',
  inbox: '<path d="M4 4h16l2 12v4H2v-4ZM2 15h6l2 3h4l2-3h6"/>',
  user: '<circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',
  plug: '<path d="m8 3 3 3M16 11l3 3M10 8l6 6-3 3a4.2 4.2 0 0 1-6-6ZM15 3l6 6M18 6l-5 5M7 17l-4 4"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  upRight: '<path d="M7 17 17 7M7 7h10v10"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  location:
    '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  bookmark: '<path d="M6 3h12v19l-6-4-6 4Z"/>',
  sparkles:
    '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4M18 4h4"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M9 21h6"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  file: '<path d="M14 2H5v20h14V7ZM14 2v5h5M8 12h8M8 16h6"/>',
  refresh:
    '<path d="M20 10a8 8 0 0 0-14-5L3 8m0-5v5h5M4 14a8 8 0 0 0 14 5l3-3m0 5v-5h-5"/>',
  shield:
    '<path d="m12 2 9 4v6c0 6-9 10-9 10S3 18 3 12V6Z"/><path d="m8 12 3 3 5-6"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  list: '<path d="M8 5h13M8 12h13M8 19h13M3 5h.1M3 12h.1M3 19h.1"/>',
  home: '<path d="m3 10 9-8 9 8v12h-7v-8h-4v8H3Z"/>',
  flag: '<path d="M4 22V3h16l-4 5 4 5H4"/>',
};
const icon = (name, cls = "") =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.grid}</svg>`;
const brand =
  '<svg viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="12" fill="#175744"/><ellipse cx="20" cy="20" rx="14" ry="7" transform="rotate(-40 20 20)" fill="none" stroke="#c7eab2" stroke-width="2.3"/><circle cx="20" cy="20" r="4.2" fill="#c7eab2"/><circle cx="30" cy="11" r="3" fill="#fff"/></svg>';
const STAGES = [
  "Saved",
  "Ready",
  "Applied",
  "Interview",
  "Offer",
  "Rejected",
  "Withdrawn",
];
const state = {
  data: null,
  integrations: {},
  route: "overview",
  selectedJobs: new Set(),
  selectedContacts: new Set(),
  jobTab: "all",
  jobsLimit: 24,
  jobFilter: { q: "", mode: "", source: "", location: "" },
  contactQuery: "",
  appsView: "board",
  appStage: "",
  apolloResults: [],
  preview: null,
  previewIndex: 0,
  busy: false,
};
const split = (s) =>
  String(s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const initials = (name) =>
  String(name || "Your workspace")
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
const date = (value, options = {}) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        ...options,
      })
    : "—";
const daysAgo = (value) => {
  const d = Math.max(0, Math.floor((Date.now() - new Date(value)) / 86400000));
  return d ? `${d}d ago` : "Today";
};
const jobFor = (app) => state.data.jobs.find((j) => j.id === app.jobId);
const mark = (name, large = false) =>
  `<span class="company-mark c${[...String(name)].reduce((a, c) => a + c.charCodeAt(0), 0) % 6}${large ? " large" : ""}">${h(String(name).slice(0, 1))}</span>`;
const badge = (stage) => `<span class="badge ${h(stage)}">${h(stage)}</span>`;
const btn = (label, action, opts = {}) =>
  `<button type="button" class="btn ${opts.cls || ""}" data-action="${action}" ${opts.id ? `data-id="${h(opts.id)}"` : ""} ${opts.disabled ? "disabled" : ""}>${opts.icon ? icon(opts.icon) : ""}${label}</button>`;
const linkButton = (label, route) =>
  `<button class="button-link" data-route="${route}">${label}${icon("arrow")}</button>`;
const heading = (title, subtitle, action = "") =>
  `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`;
const empty = (title, description, action = "", name = "search") =>
  `<div class="empty">${icon(name)}<h3>${title}</h3><p>${description}</p>${action}</div>`;
const option = (value, selected, label = value) =>
  `<option value="${h(value)}" ${selected === value ? "selected" : ""}>${h(label)}</option>`;
const sample = (job) =>
  job?.isDemo ? '<span class="badge sample">SAMPLE</span>' : "";
function completeness() {
  const d = state.data;
  const fields = [
    ["Name & email", d.profile.name && d.profile.email],
    ["Target roles", d.profile.interests?.length],
    ["Your skills", d.profile.skills?.length],
    ["Location", d.profile.location],
    ["Résumé", d.resume],
    ["Your story", d.profile.summary],
  ];
  return {
    fields,
    percent: Math.round(
      (fields.filter((f) => f[1]).length / fields.length) * 100,
    ),
  };
}
async function api(path, data, method = data === undefined ? "GET" : "POST") {
  const response = await fetch(`/api${path}`, {
    method,
    ...(data === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed.");
  return result;
}
function toast(message, error = false) {
  const node = document.createElement("div");
  node.className = `toast${error ? " error" : ""}`;
  node.append(document.createTextNode(message));
  const close = document.createElement("button");
  close.textContent = "×";
  close.setAttribute("aria-label", "Dismiss notification");
  close.addEventListener("click", () => node.remove());
  node.append(close);
  $("#toasts").append(node);
  setTimeout(() => node.remove(), error ? 12000 : 6000);
}
async function reload() {
  state.data = await api("/state");
}
function navigate(route) {
  if (location.hash === `#${route}`) {
    state.route = route;
    render();
  } else location.hash = route;
}
function navItem(route, label, name, count = "") {
  return `<button class="nav-item ${state.route === route ? "active" : ""}" data-route="${route}" ${state.route === route ? 'aria-current="page"' : ""}>${icon(name)}${label}${count !== "" ? `<span class="nav-count">${count}</span>` : ""}</button>`;
}
const routeNames = {
  overview: "Overview",
  jobs: "Find jobs",
  applications: "My applications",
  contacts: "Contacts",
  outreach: "Outreach",
  inbox: "Email updates",
  profile: "My profile",
  connections: "Connections",
};
function render() {
  if (!state.data) return;
  const d = state.data,
    route = state.route,
    p = d.profile;
  $("#app").innerHTML =
    `<div class="layout"><aside class="sidebar"><div class="brand">${brand}orbit<small>BETA</small></div><div class="workspace-switch"><span class="workspace-mark">${icon("briefcase")}</span><div class="grow">My career workspace<p class="muted tiny">${d.isDemo ? "Sample workspace" : "Personal workspace"}</p></div>${icon("down")}</div><p class="nav-label">WORKSPACE</p><nav class="nav" aria-label="Main navigation">${navItem("overview", "Overview", "grid")}${navItem("jobs", "Find jobs", "search")}${navItem("applications", "My applications", "briefcase", d.applications.length)}${navItem("contacts", "Contacts", "people")}${navItem("outreach", "Outreach", "send")}${navItem("inbox", "Email updates", "inbox", d.inbox.filter((x) => x.status === "Needs review").length || "")}</nav><div class="sidebar-section"><p class="nav-label">YOUR SETUP</p><nav class="nav" aria-label="Workspace setup">${navItem("profile", "My profile", "user")}${navItem("connections", "Connections", "plug")}</nav></div><div class="sidebar-spacer"></div><div class="help-box">${icon("sparkles")} <strong>A little closer, every day.</strong><p>Your next opportunity starts with one thoughtful step.</p>${btn("Add an application", "add-job", { icon: "plus", cls: "small full" })}</div><button class="profile-mini" data-route="profile"><span class="avatar">${h(initials(p.name))}</span><div class="grow"><strong>${h(p.name || "Your profile")}</strong><small class="muted tiny">${d.isDemo ? "Sample candidate" : "Personal workspace"}</small></div>${icon("chevron")}</button></aside><div class="main-shell"><header class="topbar"><div class="flex"><button class="icon-button mobile-menu" data-action="menu" aria-label="Open navigation">${icon("menu")}</button><div class="crumb">${icon("home")}<span class="muted">Workspace</span>${icon("chevron")}<strong>${routeNames[route]}</strong></div></div><div class="topbar-actions"><span class="date muted">${date(new Date(), { weekday: "short", year: "numeric" })}</span><button class="icon-button" data-route="inbox" aria-label="Open email updates">${icon("bell")}</button><button class="avatar sm" data-route="profile" aria-label="Open my profile">${h(initials(p.name))}</button></div></header><main id="main">${d.isDemo ? `<div class="banner">${icon("sparkles")}<span><strong>You’re exploring a sample workspace.</strong> Jobs, contacts, and activity are fictional.</span><button data-action="fresh">Start my workspace ${icon("arrow")}</button></div>` : ""}${({ overview, jobs, applications, contacts, outreach, inbox, profile, connections }[route] || overview)()}<footer class="page-footer">Made for your next chapter. &nbsp; Orbit v0.1 · Single-user prototype${d.isDemo ? " · Sample data" : ""}</footer></main></div></div>`;
}
function overview() {
  const d = state.data,
    p = d.profile,
    name = p.name?.split(" ")[0],
    hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const applied = d.applications.filter((a) =>
      ["Applied", "Interview", "Offer"].includes(a.stage),
    ).length,
    interviews = d.applications.filter((a) => a.stage === "Interview").length,
    matches = d.jobs.filter((j) => !j.archived && j.match.score >= 60).length;
  const stats = [
    [
      matches,
      "Matching opportunities",
      "sparkles",
      "green",
      "60%+ match to your saved profile",
    ],
    [
      applied,
      "Applications in motion",
      "briefcase",
      "",
      "Applied, interviewing, or offered",
    ],
    [
      interviews,
      "Interviews",
      "people",
      "orange",
      "Conversations worth preparing for",
    ],
    [
      d.contacts.filter((c) => !c.suppressed).length,
      "Contacts in your network",
      "send",
      "purple",
      "Ready for a thoughtful introduction",
    ],
  ];
  const recent = [...d.applications]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);
  const recommended = [...d.jobs]
    .filter((j) => !j.archived)
    .sort((a, b) => (b.match.score || 0) - (a.match.score || 0))
    .slice(0, 2);
  return `${heading(`${greeting}${name ? `, ${h(name)}` : ""} <span class="check-icon">✦</span>`, "A little focus. A little momentum. Your next opportunity is out there.", btn("Find my next role", "go-jobs", { cls: "primary", icon: "plus" }))}<section class="hero"><div class="hero-text"><div class="eyebrow">${icon("sparkles")} YOUR CAREER, IN MOTION</div><h2>Your next chapter.<br>A little less searching.</h2><p>Find roles that fit, keep your applications in view, and make the right introductions. All in one place.</p>${btn("Explore opportunities", "go-jobs", { cls: "primary", icon: "arrow" })}</div><div class="hero-art" aria-hidden="true"><svg viewBox="0 0 300 240"><defs><radialGradient id="sphere"><stop stop-color="#edf4d5"/><stop offset=".55" stop-color="#c4d8ac"/><stop offset="1" stop-color="#96b585"/></radialGradient></defs><g class="hero-orbit"><ellipse cx="156" cy="122" rx="127" ry="54" transform="rotate(-34 156 122)" fill="none" stroke="#a4b995" stroke-width=".8"/><ellipse cx="156" cy="122" rx="116" ry="78" transform="rotate(31 156 122)" fill="none" stroke="#a4b995" stroke-width=".7"/><circle cx="156" cy="122" r="64" fill="url(#sphere)"/><path d="M32 170c30 9 92-6 155-49 60-42 92-80 87-103" fill="none" stroke="#b9c9a8" stroke-width="1.1"/><circle cx="55" cy="170" r="10" fill="#f3f5e5" stroke="#b0c29c"/><circle cx="249" cy="69" r="7" fill="#6e905b"/><circle cx="222" cy="197" r="4" fill="#8fac7d"/><path d="m62 40 2 6 6 2-6 2-2 6-2-6-6-2 6-2M243 139l2 5 5 2-5 2-2 5-2-5-5-2 5-2" fill="#f7faeb"/></g></svg></div></section><section class="stats" aria-label="Workspace statistics">${stats.map(([n, label, ico, color, desc]) => `<article class="stat"><div class="stat-top"><span class="stat-icon ${color}">${icon(ico)}</span>${label}</div><strong>${n.toString().padStart(2, "0")}</strong><div class="stat-bottom">${desc}</div></article>`).join("")}</section><div class="dashboard-grid"><section class="panel"><div class="panel-head"><div><h2>Your applications</h2><p>Every opportunity, one clear picture.</p></div>${linkButton("View all", "applications")}</div>${recent.length ? applicationTable(recent) : empty("Your story starts here", "Save a job to start tracking your next move.", btn("Find jobs", "go-jobs", { cls: "small" }), "briefcase")}</section><div class="dashboard-side"><section class="panel"><div class="panel-head"><div><h2>Your search at a glance</h2><p>Small steps add up.</p></div>${icon("flag")}</div><div class="panel-body">${[
    "Saved",
    "Ready",
    "Applied",
    "Interview",
    "Offer",
  ]
    .map((stage) => {
      const n = d.applications.filter((a) => a.stage === stage).length;
      return `<div class="pipeline-summary"><span>${stage}</span><strong>${n.toString().padStart(2, "0")}</strong></div><meter min="0" max="${Math.max(d.applications.length, 1)}" value="${n}" aria-label="${stage}: ${n}"></meter>`;
    })
    .join(
      "",
    )}<div class="tip">${icon("sparkles")} &nbsp; A focused shortlist makes room for applications that tell your story.</div></div></section></div></div><div class="quick-links"><button class="quick-card" data-route="profile">${icon("file")}<div class="grow"><strong>Make your profile yours</strong><p>Your résumé and preferences, ready to go.</p></div>${icon("chevron")}</button><button class="quick-card" data-route="contacts">${icon("people")}<div class="grow"><strong>Start a conversation</strong><p>Find the people behind the opportunities.</p></div>${icon("chevron")}</button><button class="quick-card" data-route="connections">${icon("plug")}<div class="grow"><strong>Bring your tools together</strong><p>Manage job feeds and outreach connections.</p></div>${icon("chevron")}</button></div><div class="section-heading"><h2>Opportunities for you</h2>${linkButton("Explore all jobs", "jobs")}</div><div class="job-grid">${recommended.length ? recommended.map((j) => jobCard(j)).join("") : `<section class="panel">${empty("Let’s find your next role", "Add your target roles, then refresh a job source.", btn("Set up sources", "go-connections", { cls: "small" }))}</section>`}</div>`;
}
function applicationTable(list) {
  return `<div class="table-scroll"><table><thead><tr><th>COMPANY & ROLE</th><th>STATUS</th><th>UPDATED</th><th><span class="sr-only">Details</span></th></tr></thead><tbody>${list
    .map((a) => {
      const j = jobFor(a);
      if (!j) return "";
      return `<tr><td><div class="flex">${mark(j.company)}<div><strong>${h(j.title)}</strong><span class="muted">${h(j.company)} ${sample(j)}</span></div></div></td><td>${badge(a.stage)}</td><td class="muted">${date(a.updatedAt)}</td><td><button class="icon-button" data-action="app-detail" data-id="${a.id}" aria-label="View ${h(j.title)} application">${icon("chevron")}</button></td></tr>`;
    })
    .join("")}</tbody></table></div>`;
}
function jobCard(j, selectable = false) {
  const a = state.data.applications.find((x) => x.jobId === j.id),
    selected = state.selectedJobs.has(j.id);
  return `<article class="job-card${selected ? " selected-card" : ""}"><div class="job-top">${selectable ? `<input type="checkbox" class="job-select" data-job-select="${j.id}" aria-label="Select ${h(j.title)} at ${h(j.company)}" ${selected ? "checked" : ""}>` : ""}${mark(j.company)}<div class="grow"><div class="company-name">${h(j.company)} &nbsp; ${sample(j)}</div><button data-action="job-detail" data-id="${j.id}"><h3>${h(j.title)}</h3></button></div><button class="icon-button" data-action="save-job" data-id="${j.id}" aria-label="${a ? "View saved" : "Save"} ${h(j.title)}">${icon(a ? "check" : "bookmark")}</button></div><div class="job-meta"><span>${icon("location")}${h(j.location)}</span><span>${icon("globe")}${h(j.workMode)}</span><span>${icon("clock")}${daysAgo(j.publishedAt)}</span></div><div class="job-tags">${(
    j.tags || []
  )
    .slice(0, 4)
    .map((tag) => `<span class="tag">${h(tag)}</span>`)
    .join(
      "",
    )}<span class="tag">${h(j.source)}</span></div><div class="job-footer"><span class="salary">${h(j.salary)}${j.isDemo ? "<span> / year · sample</span>" : ""}</span><button class="match ${j.match.score < 60 ? "low" : ""}" data-action="job-detail" data-id="${j.id}">${icon("sparkles")}${j.match.score === null ? "Set up matching" : `${j.match.score}% match`}</button></div></article>`;
}
function filteredJobs() {
  const f = state.jobFilter;
  const saved = new Set(state.data.applications.map((a) => a.jobId));
  return state.data.jobs
    .filter(
      (j) =>
        !j.archived &&
        (state.jobTab !== "saved" || saved.has(j.id)) &&
        (state.jobTab !== "matches" || j.match.score >= 60) &&
        (!f.q ||
          `${j.title} ${j.company} ${(j.tags || []).join(" ")} ${j.category}`
            .toLowerCase()
            .includes(f.q.toLowerCase())) &&
        (!f.location ||
          j.location.toLowerCase().includes(f.location.toLowerCase())) &&
        (!f.mode || j.workMode === f.mode) &&
        (!f.source || j.source === f.source),
    )
    .sort((a, b) => (b.match.score || 0) - (a.match.score || 0));
}
function jobs() {
  const f = state.jobFilter,
    sources = [...new Set(state.data.jobs.map((j) => j.source))];
  return `${heading("Find your next thing.", "Opportunities that fit your skills, interests, and the way you want to work.", `<div class="flex">${btn("Add a job", "add-job", { icon: "plus" })}${btn("Refresh sources", "sync-jobs", { cls: "primary", icon: "refresh" })}</div>`)}<div class="tabs" role="tablist" aria-label="Job views">${[
    ["all", "All opportunities"],
    ["matches", "Best matches"],
    ["saved", "Saved jobs"],
  ]
    .map(
      ([v, l]) =>
        `<button role="tab" aria-selected="${state.jobTab === v}" class="tab ${state.jobTab === v ? "active" : ""}" data-action="job-tab" data-id="${v}">${l}</button>`,
    )
    .join(
      "",
    )}</div><div class="toolbar"><label class="search-input">${icon("search")}<input data-filter="q" value="${h(f.q)}" placeholder="Role, skill, or company…" aria-label="Search jobs"></label><label class="search-input">${icon("location")}<input data-filter="location" value="${h(f.location)}" placeholder="City, country, or worldwide…" aria-label="Filter job location"></label><select data-filter="mode" aria-label="Work preference">${option("", f.mode, "All work styles")}${["Remote", "Hybrid", "On-site"].map((x) => option(x, f.mode)).join("")}</select><select data-filter="source" aria-label="Job source">${option("", f.source, "All sources")}${sources.map((x) => option(x, f.source)).join("")}</select></div><div id="job-results">${jobResults()}</div><div class="notice mt">Match scores are a transparent keyword comparison with your saved profile, not an assessment of hiring probability. Check location and work authorization on each listing. Jobs sourced from Remotive link back to Remotive.</div><div class="section-heading"><h2>Keep exploring</h2><span class="small muted">External search links</span></div><div class="horizontal-options">${[
    [
      "LinkedIn",
      `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(state.data.profile.interests.join(" ") || "jobs")}`,
    ],
    [
      "Indeed",
      `https://www.indeed.com/jobs?q=${encodeURIComponent(state.data.profile.interests.join(" ") || "jobs")}`,
    ],
    ["Naukri", "https://www.naukri.com/"],
    ["Wellfound", "https://wellfound.com/jobs"],
  ]
    .map(
      ([name, url]) =>
        `<a class="btn small" href="${h(url)}" target="_blank" rel="noopener noreferrer">${name}${icon("upRight")}</a>`,
    )
    .join(
      "",
    )}</div><p class="hint">These boards open separately. Their listings are not imported in this prototype; use Add a job to track one.</p>`;
}
function jobResults() {
  const jobs = filteredJobs();
  return `<div class="spread mb"><p class="list-summary">${jobs.length} opportunit${jobs.length === 1 ? "y" : "ies"} · Sorted by profile match</p><span class="sample-label">${jobs.some((j) => j.isDemo) ? "Sample listings are labeled individually" : ""}</span></div><div class="job-grid">${
    jobs.length
      ? jobs
          .slice(0, state.jobsLimit)
          .map((j) => jobCard(j, true))
          .join("")
      : `<section class="panel">${empty("No opportunities here yet", "Try a broader search or refresh a job source.", btn("Manage sources", "go-connections", { cls: "small" }))}</section>`
  }</div>${jobs.length > state.jobsLimit ? `<div class="mt right">${btn("Show more jobs", "more-jobs")}</div>` : ""}${state.selectedJobs.size ? `<div class="bulk-bar">${icon("briefcase")}<strong>${state.selectedJobs.size} selected</strong><span class="small">Prepare together. Submit individually.</span>${btn("Prepare applications", "prepare-batch", { cls: "light", icon: "arrow" })}${btn("Clear", "clear-jobs", { cls: "ghost" })}</div>` : ""}`;
}
function applications() {
  const list = state.data.applications.filter(
    (a) => !state.appStage || a.stage === state.appStage,
  );
  return `${heading("Every opportunity, in view.", "From the first save to the next conversation. Keep your search moving.", `<a class="btn" href="/api/export/applications">${icon("download")}Export CSV</a>`)}<div class="toolbar"><select id="app-stage" aria-label="Filter application stage">${option("", state.appStage, "All stages")}${STAGES.map((s) => option(s, state.appStage)).join("")}</select><span class="grow small muted">${list.length} tracked opportunit${list.length === 1 ? "y" : "ies"}</span>${btn("Board", "apps-board", { cls: `small ${state.appsView === "board" ? "light" : ""}`, icon: "grid" })}${btn("List", "apps-list", { cls: `small ${state.appsView === "list" ? "light" : ""}`, icon: "list" })}${btn("Add application", "add-job", { cls: "primary small", icon: "plus" })}</div>${
    !list.length
      ? `<section class="panel">${empty("Make your first move", "Save a job or add an existing application to get started.", btn("Find jobs", "go-jobs", { cls: "primary" }), "briefcase")}</section>`
      : state.appsView === "list"
        ? `<section class="panel">${applicationTable(list)}</section>`
        : `<div class="board">${(state.appStage
            ? [state.appStage]
            : [
                "Saved",
                "Ready",
                "Applied",
                "Interview",
                "Offer",
                "Rejected",
                "Withdrawn",
              ]
          )
            .map((stage) => {
              const group = list.filter((a) => a.stage === stage);
              return `<section class="board-column"><div class="board-heading">${badge(stage)}<span class="board-count">${group.length}</span></div>${group
                .map((a) => {
                  const j = jobFor(a);
                  if (!j) return "";
                  return `<button class="application-card" data-action="app-detail" data-id="${a.id}"><div class="spread">${mark(j.company)}${sample(j)}</div><h3>${h(j.title)}</h3><p>${h(j.company)}</p><div class="date">Updated ${date(a.updatedAt)}</div></button>`;
                })
                .join(
                  "",
                )}${!group.length ? '<p class="hint">Room for the next step.</p>' : ""}</section>`;
            })
            .join("")}</div>`
  }<div class="notice mt">“Ready” means your application is prepared. Opening an employer’s application page does not mark it as submitted. Update the stage after you apply, or approve a status suggestion from Email updates.</div>`;
}
function contacts() {
  return `${heading("Meet the people behind the roles.", "Build a focused contact list. Send an introduction that feels like you.", `<div class="flex">${btn("Import CSV", "import-contacts", { icon: "upload" })}${btn("Find with Apollo", "apollo-search", { cls: "primary", icon: "search" })}</div>`)}<div class="stats">${[
    [state.data.contacts.length, "Total contacts", "people", "green"],
    [
      state.data.contacts.filter(
        (c) => c.emailStatus === "verified" && !c.suppressed && !c.isDemo,
      ).length,
      "Verified work emails",
      "shield",
      "",
    ],
    [
      state.data.contacts.filter((c) => !c.email).length,
      "Awaiting enrichment",
      "sparkles",
      "orange",
    ],
    [
      state.data.contacts.filter((c) => c.suppressed).length,
      "Suppressed contacts",
      "inbox",
      "purple",
    ],
  ]
    .map(
      ([n, l, ico, color]) =>
        `<div class="stat"><div class="stat-top"><span class="stat-icon ${color}">${icon(ico)}</span>${l}</div><strong>${n.toString().padStart(2, "0")}</strong></div>`,
    )
    .join(
      "",
    )}</div><div class="toolbar"><label class="search-input">${icon("search")}<input id="contact-search" placeholder="Search names, companies, or roles…" aria-label="Search contacts" value="${h(state.contactQuery)}"></label>${btn("Add a contact", "add-contact", { icon: "plus" })}${btn("Create outreach", "selected-outreach", { cls: "primary", icon: "send" })}</div><section class="panel" id="contacts-table">${contactsTable()}</section><div class="notice mt">Apollo search finds people. Email enrichment is a separate action that may use Apollo credits. Imported “verified” labels are supplied by your CSV, not independently checked by Orbit. Suppressed contacts are always excluded from campaign previews and sending.</div>`;
}
function contactsTable() {
  const q = state.contactQuery.toLowerCase(),
    list = state.data.contacts.filter((c) =>
      `${c.name} ${c.company} ${c.title} ${c.email}`.toLowerCase().includes(q),
    );
  return list.length
    ? `<div class="table-scroll"><table><thead><tr><th><input type="checkbox" id="select-all-contacts" aria-label="Select all visible contacts" ${list.every((c) => state.selectedContacts.has(c.id)) ? "checked" : ""}></th><th>NAME</th><th>COMPANY & ROLE</th><th>EMAIL</th><th>SOURCE</th><th>ACTIONS</th></tr></thead><tbody>${list.map((c) => `<tr><td><input type="checkbox" data-contact-select="${c.id}" aria-label="Select ${h(c.name)}" ${state.selectedContacts.has(c.id) ? "checked" : ""}></td><td><div class="flex"><span class="avatar sm">${h(initials(c.name))}</span><strong>${h(c.name)}</strong></div></td><td><strong>${h(c.company || "Not listed")}</strong><span class="muted">${h(c.title)}</span></td><td><strong>${h(c.email || "Enrichment needed")}</strong>${badge(c.suppressed ? "suppressed" : c.emailStatus)} ${c.isDemo ? '<span class="badge sample">SAMPLE</span>' : ""}</td><td class="muted">${h(c.source)}</td><td><div class="flex">${!c.email && c.source === "Apollo" ? btn("Enrich", "enrich-contact", { id: c.id, cls: "small" }) : ""}<button class="button-link" data-action="suppress-contact" data-id="${c.id}">${c.suppressed ? "Restore" : "Suppress"}</button></div></td></tr>`).join("")}</tbody></table></div>`
    : empty(
        "Your next connection starts here",
        "Find hiring teams with Apollo, add a contact, or import a CSV.",
        btn("Import contacts", "import-contacts", { cls: "small" }),
        "people",
      );
}
function outreach() {
  const eligible = state.data.contacts.filter((c) => !c.suppressed),
    p = state.data.profile;
  return `${heading("A thoughtful hello goes further.", "Personalize your introduction, attach your résumé, and review every recipient.")}<div class="two-column"><form id="campaign-form"><section class="form-section"><h2>Your next introduction</h2><p>Start with a template. Make it your own.</p><div class="form-grid"><label class="field span2">Campaign name<input class="input" name="name" required maxlength="150" placeholder="e.g. Frontend opportunities · October"></label><label class="field span2">Subject<input class="input" name="subject" required maxlength="500" value="Exploring {{my_role}} opportunities at {{company}}"></label><label class="field span2">Message<textarea name="body" id="campaign-body" rows="11" required maxlength="15000">Hi {{first_name}},

I’m {{my_name}}, a {{my_role}}. I’m interested in the work your team is doing at {{company}} and would love to explore relevant opportunities.

My background includes {{skills}}. I’ve attached my résumé for context and would welcome a brief conversation if there’s a fit.

Would you be open to connecting?</textarea><small>Your name, email, and an opt-out line are added to each message.</small></label></div><div class="variables">${["first_name", "company", "my_name", "my_role", "skills", "portfolio"].map((v) => `<button type="button" class="variable" data-action="insert-var" data-id="${v}">{{${v}}}</button>`).join("")}</div><div class="line"></div><label class="checkbox-label"><input type="checkbox" name="attachResume" ${state.data.resume ? "checked" : ""} ${state.data.resume ? "" : "disabled"}><span>Attach my résumé${state.data.resume ? ` <strong>${h(state.data.resume.name)}</strong>` : " · Upload one in My profile first."}</span></label></section><section class="form-section"><div class="spread mb"><h2>Who would you like to reach?</h2><span class="small muted">Up to 100 contacts</span></div><div class="contact-list">${eligible.length ? eligible.map((c) => `<label class="contact-row"><input type="checkbox" name="recipients" value="${c.id}" ${state.selectedContacts.has(c.id) ? "checked" : ""}><div class="grow"><strong>${h(c.name)} <span class="muted">· ${h(c.company)}</span></strong><p>${h(c.email || "Email enrichment needed")}</p></div>${c.isDemo ? '<span class="badge sample">SAMPLE</span>' : badge(c.emailStatus)}</label>`).join("") : '<p class="hint">Add contacts before creating a campaign.</p>'}</div><div class="modal-actions"><button class="btn" type="submit" name="intent" value="save">Save draft</button><button class="btn primary" type="submit" name="intent" value="preview">${icon("sparkles")}Review campaign</button></div></section></form><div class="stack"><section class="panel"><div class="panel-head"><h2>A good introduction is personal.</h2>${icon("sparkles")}</div><div class="panel-body"><ul class="checklist"><li>Lead with the person, not the pitch.${icon("check")}</li><li>Give them a reason to keep reading.${icon("check")}</li><li>Keep the ask clear and small.${icon("check")}</li><li>Review the résumé you’re attaching.${icon("check")}</li></ul><div class="tip">${state.integrations.liveSend ? "Live email is enabled. Each campaign still requires a fresh preview and explicit approval." : "Preview mode is on. You can download email drafts with attachments. No email leaves Orbit until sending is configured and approved."}</div></div></section><section class="panel"><div class="panel-head"><h2>Your campaigns</h2><span class="badge">${state.data.campaigns.length}</span></div>${state.data.campaigns.length ? state.data.campaigns.map((c) => `<div class="campaign-row"><span class="stat-icon green">${icon("send")}</span><div class="grow"><h3>${h(c.name)}</h3><p>${c.contactIds.length} recipients · ${h(c.status)}</p></div>${!c.deliveries.length ? `<button class="button-link" data-action="edit-campaign" data-id="${c.id}">Edit</button>` : ""}<button class="icon-button" data-action="preview-campaign" data-id="${c.id}" aria-label="Review ${h(c.name)}">${icon("chevron")}</button></div>`).join("") : empty("Your first hello is waiting", "Campaign drafts will appear here.", "", "send")}</section><div class="notice">${h(p.name || "Your name")}<br>${h(p.email || "Add your email in My profile")}<br><button class="button-link mt" data-route="profile">Edit sender profile ${icon("arrow")}</button></div></div></div>`;
}
function inbox() {
  return `${heading("The next step, without the guesswork.", "Import an email update, review the suggested stage, and keep your tracker current.", btn("Import an update", "import-email", { cls: "primary", icon: "plus" }))}<div class="banner info">${icon("inbox")}<span>Mailbox sync is planned. This prototype analyzes emails you paste in and changes a status only after you approve it.</span></div><section class="panel">${
    state.data.inbox.length
      ? state.data.inbox
          .map((item) => {
            const a = state.data.applications.find(
                (a) => a.id === item.applicationId,
              ),
              j = a && jobFor(a);
            return `<article class="inbox-item"><div class="spread"><span class="small muted">${h(item.from || "Imported email")} · ${date(item.createdAt)}</span>${badge(item.status)}</div><h3>${h(item.subject)}</h3><p>${h(item.body.slice(0, 350))}${item.body.length > 350 ? "…" : ""}</p><div class="spread mt mobile-stack"><div class="small muted">${h(j?.company)} · ${h(j?.title)}${item.proposedStage ? ` &nbsp; ${icon("arrow")} ${badge(item.proposedStage)}` : '<p class="hint">No clear status detected. Review and update the application manually.</p>'}</div>${item.status === "Needs review" ? `<div class="flex">${btn("Dismiss", "dismiss-email", { id: item.id, cls: "small" })}${btn("Apply suggestion", "accept-email", { id: item.id, cls: "primary small", disabled: !item.proposedStage })}</div>` : ""}</div></article>`;
          })
          .join("")
      : empty(
          "Room for good news.",
          "Paste an application confirmation, interview invitation, or decision email.",
          btn("Import an email", "import-email", { cls: "small" }),
          "inbox",
        )
  }</section>`;
}
function profile() {
  const p = state.data.profile,
    r = state.data.resume,
    c = completeness();
  const input = (label, name, type = "text", placeholder = "") =>
    `<label class="field">${label}<input class="input" type="${type}" name="${name}" value="${h(p[name] || "")}" placeholder="${placeholder}" ${name === "email" ? 'autocomplete="email"' : ""}></label>`;
  return `${heading("The story only you can tell.", "Add your background once. Carry it into every next opportunity.")}<div class="profile-grid"><form id="profile-form"><section class="form-section"><h2>A little about you</h2><p>Your details stay in this single-user workspace.</p><div class="form-grid">${input("Full name", "name", "text", "Your full name")}${input("Email address", "email", "email", "you@example.com")}${input("Phone", "phone", "tel", "+91 …")}${input("Current location", "location", "text", "e.g. Bengaluru")}${input("Professional headline", "headline", "text", "e.g. Frontend engineer")}${input("Portfolio or LinkedIn", "portfolio", "url", "https://…")}<label class="field span2">Your story<textarea name="summary" rows="4" maxlength="6000" placeholder="A short introduction, a project you’re proud of, or the work you want to do next.">${h(p.summary)}</textarea></label></div></section><section class="form-section"><h2>What are you looking for?</h2><p>These preferences help rank opportunities. Keep them specific to you.</p><div class="form-grid"><label class="field span2">Target roles or fields of interest<input class="input" name="interests" value="${h(p.interests.join(", "))}" placeholder="Frontend engineer, product engineer"><small>Separate roles or fields with commas.</small></label><label class="field span2">Skills<input class="input" name="skills" value="${h(p.skills.join(", "))}" placeholder="React, TypeScript, SQL"><small>Separate skills with commas. Matching uses these exact terms.</small></label><label class="field">Work preference<select name="workMode">${["Any", "Remote", "Hybrid", "On-site"].map((v) => option(v, p.workMode)).join("")}</select></label>${input("Work authorization / visa notes", "authorization", "text", "Confirm for each job")}</div><div class="modal-actions"><button class="btn primary" type="submit">${icon("check")}Save my profile</button></div></section></form><div class="profile-side"><section class="form-section"><h2>Your résumé, ready to go.</h2><p>PDF, DOCX, or TXT. Up to 5 MB.</p><label class="dropzone" id="resume-drop">${icon("upload")}<strong>Click to upload or drop a file</strong><small>A good story deserves a good introduction.</small><input class="sr-only" type="file" id="resume-input" accept=".pdf,.docx,.txt" aria-label="Upload résumé"></label>${r ? `<div class="file-card">${icon("file")}<div class="grow"><strong>${h(r.name)}</strong><p>${Math.ceil(r.size / 1000)} KB · ${date(r.uploadedAt)}</p></div><a href="/api/resume/download" aria-label="Download résumé">${icon("download")}</a></div><div class="spread"><button class="button-link" data-action="resume-text">Review extracted text</button><button class="button-link danger-text" data-action="remove-resume">Remove file</button></div>` : '<p class="hint">We suggest recognized skills and an email from the text. Review them before adding them to your profile.</p>'}</section><section class="form-section"><h2>A stronger starting point.</h2><div class="progress-circle">${c.percent}%</div><ul class="checklist">${c.fields.map(([name, yes]) => `<li>${name}${yes ? icon("check") : "<span>○</span>"}</li>`).join("")}</ul><div class="tip">Profile completeness is a setup checklist, not a résumé quality score.</div></section></div></div>`;
}
function connections() {
  const s = state.data.settings;
  const providers = [
    [
      "Remotive",
      "R",
      "Public remote-job feed with source attribution. Cached for six hours between successful refreshes.",
      true,
      "green",
    ],
    [
      "Greenhouse",
      "g",
      "Read published roles from company job boards you choose. Enter their board slugs below.",
      true,
      "green",
    ],
    [
      "Lever",
      "L",
      "Import public postings from selected company boards. Enter their account slugs below.",
      true,
      "blue",
    ],
    [
      "Apollo",
      "a",
      "Search people by company and role. Enrich selected contacts for work emails in a separate step.",
      state.integrations.apollo,
      "orange",
    ],
    [
      "Resend",
      "↗",
      "Send individual, personalized emails with your résumé after preview and explicit approval.",
      state.integrations.resend,
      "blue",
    ],
    [
      "Gmail & Outlook",
      "M",
      "Automatic mailbox scanning and OAuth connections are planned. Paste email updates for now.",
      false,
      "orange",
    ],
  ];
  return `${heading("Your tools, working together.", "Know what’s ready, what needs a key, and what’s coming next.")}<div class="connection-grid">${providers.map(([name, initial, desc, enabled, color]) => `<article class="connection-card"><div class="spread"><span class="provider-mark ${color}">${initial}</span><span class="badge ${enabled ? "green" : ""}">${name.includes("Gmail") ? "Planned" : enabled ? (name === "Resend" ? "Configured" : name === "Apollo" ? "Key configured" : "Adapter ready") : "Needs server key"}</span></div><h3>${name}</h3><p>${desc}</p>${name === "Apollo" ? btn("Search contacts", "apollo-search", { cls: "small" }) : name === "Resend" ? btn("Go to outreach", "go-outreach", { cls: "small" }) : name === "Remotive" ? btn("Refresh feed", "sync-remotive", { cls: "small", icon: "refresh" }) : name === "Gmail & Outlook" ? btn("Import an email", "import-email", { cls: "small" }) : '<span class="hint">Configure company boards below.</span>'}</article>`).join("")}</div><div class="two-column mt"><form class="form-section" id="connections-form"><h2>Choose your company job boards</h2><p>A board slug is the company part of its Greenhouse or Lever job-board URL. Save the slugs before refreshing.</p><div class="form-grid"><label class="field span2">Greenhouse board slugs<input class="input" name="greenhouseBoards" value="${h(s.greenhouseBoards.join(", "))}" placeholder="company-one, company-two"><small>From boards.greenhouse.io/company-one or job-boards.greenhouse.io/company-one.</small></label><label class="field span2">Lever account slugs<input class="input" name="leverBoards" value="${h(s.leverBoards.join(", "))}" placeholder="company-one, company-two"><small>From jobs.lever.co/company-one. Up to 10 boards per provider.</small></label></div><div class="modal-actions"><button class="btn primary" type="submit">Save job sources</button>${btn("Refresh sources", "sync-jobs", { icon: "refresh" })}</div></form><div class="stack"><section class="form-section"><h2>Server configuration</h2><p>API keys are configured in your server’s environment. They are never entered into or exposed by this interface.</p><div class="notice mono">APOLLO_API_KEY<br>RESEND_API_KEY<br>EMAIL_FROM<br>ENABLE_LIVE_SEND=true</div><p class="hint">Live sending: ${state.integrations.liveSend ? "enabled, with per-campaign approval" : "disabled; previews and downloadable drafts work"}</p></section><section class="form-section"><h2>Your workspace</h2><p>Start with your own information or explore the fictional sample data. Resetting removes the current profile, files, and records.</p><div class="flex wrap">${btn("Start fresh", "fresh", { cls: "small" })}${btn("Load sample workspace", "demo", { cls: "small" })}</div></section></div></div>${
    Object.keys(state.data.syncs).length
      ? `<section class="panel"><div class="panel-head"><h2>Source activity</h2></div><div class="panel-body">${Object.entries(
          state.data.syncs,
        )
          .map(
            ([key, value]) =>
              `<div class="contact-row"><div class="grow"><strong>${h(key.replace(":", " · "))}</strong><p>${date(value.at)} · ${value.ok ? `${value.count} jobs in last sync` : h(value.error || "Sync did not complete")}</p></div>${badge(value.ok ? "Updated" : "Needs attention")}</div>`,
          )
          .join("")}</div></section>`
      : ""
  }<div class="notice mt">Direct submission to employer systems, universal job-board aggregation, and automatic inbox scanning are not part of v0.1. The application workflow prepares your details and opens the employer’s form for you to complete.</div>`;
}

function modal(title, content, cls = "") {
  const el = $("#modal");
  el.className = cls;
  el.innerHTML = `<div class="modal-head"><h2 id="modal-title">${title}</h2><button class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon("close")}</button></div><div class="modal-body">${content}</div>`;
  if (!el.open) el.showModal();
}
const closeModal = () => $("#modal").close();
function jobDetail(jid) {
  const j = state.data.jobs.find((j) => j.id === jid);
  if (!j) return;
  const a = state.data.applications.find((a) => a.jobId === jid);
  modal(
    "A closer look",
    `<div class="spread">${mark(j.company, true)}${sample(j)}</div><h2 class="detail-title">${h(j.title)}</h2><p class="detail-company">${h(j.company)} · ${h(j.location)}</p><div class="job-meta"><span>${icon("globe")}${h(j.workMode)}</span><span>${icon("briefcase")}${h(j.type)}</span><span>${icon("clock")}${date(j.publishedAt)}</span></div><div class="job-tags">${j.tags.map((t) => `<span class="tag">${h(t)}</span>`).join("")}</div><div class="match-card"><strong>${j.match.score === null ? "Your profile makes the match." : `${j.match.score}% profile match`}</strong><ul>${j.match.reasons.map((r) => `<li>${h(r)}</li>`).join("")}</ul><p class="hint">Skill terms found: ${h(j.match.matched.join(", ") || "None yet")}. Exact keyword matches; review the requirements yourself.</p></div><h3 class="detail-label">About this opportunity</h3><p class="detail-description">${h(j.description || "Read the full listing on the original job board.")}</p><h3 class="detail-label">Compensation</h3><p class="small">${h(j.salary)} ${j.isDemo ? "· Illustrative sample" : ""}</p><div class="line"></div><p class="hint">Source: ${h(j.source)}${j.board ? ` · ${h(j.board)}` : ""}${j.archived ? " · Not present in the latest source sync; may be closed." : ""}</p><div class="modal-actions">${btn(a ? "View in tracker" : "Save opportunity", a ? "app-detail" : "save-job", { id: a ? a.id : j.id, icon: "bookmark" })}${btn("Prepare application", "prepare-one", { id: j.id, cls: "primary", icon: "arrow" })}</div>`,
    "drawer",
  );
}
function appDetail(aid) {
  const a = state.data.applications.find((a) => a.id === aid),
    j = a && jobFor(a);
  if (!j) return;
  modal(
    "Your application",
    `<div class="spread">${mark(j.company, true)}${sample(j)}</div><h2 class="detail-title">${h(j.title)}</h2><p class="detail-company">${h(j.company)} · ${h(j.location)}</p><form id="application-form" data-id="${a.id}" class="mt stack"><label class="field">Application stage<select name="stage">${STAGES.map((s) => option(s, a.stage)).join("")}</select><small>Mark Applied after you complete the employer’s form.</small></label><label class="field">Your notes<textarea name="notes" rows="4" maxlength="6000" placeholder="Contacts, next steps, interview notes…">${h(a.notes)}</textarea></label><div class="spread wrap"><a class="btn small" href="/api/applications/${a.id}/packet">${icon("download")}Download application packet</a><button class="btn primary small" type="submit">Save changes</button></div></form><div class="line"></div>${j.url ? `<a class="btn full" target="_blank" rel="noopener noreferrer" href="${h(j.url)}">Open employer application ${icon("upRight")}</a><p class="hint">Complete and submit the form there. Orbit does not submit this application.</p>` : '<div class="notice">This is a fictional sample job. There is no live application form.</div>'}<h3 class="detail-label">Activity</h3><div class="timeline">${[
      ...a.history,
    ]
      .reverse()
      .slice(0, 12)
      .map(
        (e) =>
          `<div class="timeline-item"><strong>${h(e.stage)}</strong><p>${h(e.source)} · ${date(e.at)}</p></div>`,
      )
      .join("")}</div>`,
    "drawer",
  );
}
async function previewCampaign(cid) {
  state.preview = await api(`/campaigns/${cid}/preview`, {});
  state.previewIndex = 0;
  campaignPreview();
}
function campaignPreview() {
  const p = state.preview,
    m = p.messages[state.previewIndex],
    canSend =
      p.liveSendReady &&
      p.messages.every((m) => !m.isDemo && m.emailStatus === "verified");
  const c = state.data.campaigns.find((c) => c.id === p.campaignId);
  modal(
    "A final look before hello.",
    `<div class="spread mb"><p class="small muted">${p.messages.length} personalized message${p.messages.length === 1 ? "" : "s"} · ${p.excluded.length} excluded${p.attachment ? " · Résumé attached" : ""}</p><span class="badge ${canSend ? "green" : ""}">${canSend ? "Review before sending" : "Preview only"}</span></div><div class="draft-choices">${p.messages.map((m, i) => `<button class="draft-choice ${i === state.previewIndex ? "active" : ""}" data-action="preview-person" data-id="${i}">${h(m.name)}</button>`).join("")}</div><div class="email-preview"><div class="email-header">To &nbsp; <strong>${h(m.name)} &lt;${h(m.to)}&gt;</strong><br>Subject &nbsp; <strong>${h(m.subject)}</strong></div><div class="email-body">${h(m.body)}</div>${p.attachment ? `<div class="attachment">${icon("file")}${h(p.attachment.name)} · ${Math.ceil(p.attachment.size / 1000)} KB</div>` : ""}</div>${p.excluded.length ? `<p class="hint">Excluded: ${p.excluded.map((e) => `${h(e.name)} (${h(e.reason)})`).join(", ")}</p>` : ""}${!canSend ? '<div class="banner warning mt"><span>No email will be sent. Live email requires server configuration, a real sender profile, and verified, non-sample recipients. You can download each message as an email draft.</span></div>' : `<label class="checkbox-label mt"><input type="checkbox" id="approve-send"><span>I have reviewed these ${p.messages.length} recipients, the message, and the attachment, and approve sending this campaign.</span></label>`}${
      c?.deliveries?.length
        ? `<div class="notice mt">${c.deliveries
            .map((d) => {
              const contact = state.data.contacts.find(
                (c) => c.id === d.contactId,
              );
              return `${h(contact?.name || d.contactId)}: ${h(d.status)}${d.error ? ` · ${h(d.error)}` : ""}`;
            })
            .join("<br>")}</div>`
        : ""
    }<div class="modal-actions"><a class="btn" href="/api/campaigns/${p.campaignId}/messages/${m.contactId}">${icon("download")}Download this draft</a>${canSend ? btn(`Send ${p.messages.length} emails`, "send-campaign", { id: p.campaignId, cls: "primary", icon: "send" }) : btn("Done reviewing", "close-modal", { cls: "primary", icon: "check" })}</div>`,
    "wide",
  );
}
function addJobModal() {
  modal(
    "Add an opportunity",
    `<p>Found a role elsewhere? Add its link and keep it in your tracker.</p><form id="manual-job-form" class="mt"><div class="form-grid"><label class="field">Job title<input class="input" name="title" required maxlength="200"></label><label class="field">Company<input class="input" name="company" required maxlength="150"></label><label class="field span2">Application link<input class="input" name="url" type="url" placeholder="https://…" required></label><label class="field">Location<input class="input" name="location"></label><label class="field">Work style<select name="workMode">${["Remote", "Hybrid", "On-site"].map((v) => option(v, "Remote")).join("")}</select></label><label class="field span2">Job description<textarea name="description" rows="4" maxlength="30000" placeholder="Paste the description to compare it with your skills."></textarea></label><label class="field">Current stage<select name="stage">${STAGES.map((v) => option(v, "Saved")).join("")}</select></label></div><div class="modal-actions"><button class="btn primary" type="submit">${icon("plus")}Add to tracker</button></div></form>`,
  );
}
function apolloModal() {
  modal(
    "Find your next connection",
    `<p>Search Apollo’s people database by company domain and role. Search results do not reveal work emails; enrich selected contacts separately.</p>${!state.integrations.apollo ? '<div class="banner warning mt"><span>A server administrator needs to set APOLLO_API_KEY first. CSV import and manual contacts work without it.</span></div>' : ""}<form id="apollo-form" class="mt stack"><label class="field">Company domain<input class="input" name="domain" placeholder="e.g. company.com"></label><label class="field">People to find<input class="input" name="titles" placeholder="Technical Recruiter, Engineering Manager"><small>Comma-separated job titles. Up to 25 results per search.</small></label><button class="btn primary" type="submit">${icon("search")}Search Apollo</button></form><div id="apollo-results"></div>`,
  );
}
function emailModal() {
  modal(
    "Bring an update into view",
    `<p>Choose the application this email belongs to. Orbit suggests a stage using simple phrase rules; you review the suggestion before it changes your tracker.</p><form id="email-form" class="mt stack"><label class="field">Application<select name="applicationId" required>${state.data.applications
      .map((a) => {
        const j = jobFor(a);
        return `<option value="${a.id}">${h(j?.company)} · ${h(j?.title)}</option>`;
      })
      .join(
        "",
      )}</select></label><label class="field">From<input class="input" name="from" placeholder="Hiring team or sender address"></label><label class="field">Email subject<input class="input" name="subject" required maxlength="500"></label><label class="field">Email body<textarea name="body" required rows="7" maxlength="15000" placeholder="Paste the application update here…"></textarea></label><div class="modal-actions"><button class="btn primary" type="submit">${icon("sparkles")}Analyze update</button></div></form>`,
  );
}
function importContactsModal() {
  modal(
    "Bring your contacts with you",
    `<p>Import up to 500 contacts. Duplicates are skipped by email address.</p><p class="hint">Columns: name, email, company, title, email_status. Use verified only when your data provider reports it.</p><form id="import-contacts-form" class="mt stack"><label class="field">Choose a CSV file<input type="file" id="contacts-file" accept=".csv,text/csv" class="input"></label><label class="field">Or paste your CSV<textarea id="csv-input" name="csv" rows="8" placeholder="name,email,company,title,email_status"></textarea></label><div class="modal-actions"><button class="btn primary" type="submit">${icon("upload")}Import contacts</button></div></form>`,
  );
}
async function syncJobs(remotiveOnly = false) {
  const settings = state.data.settings,
    sources = [
      { source: "Remotive", board: "" },
      ...(!remotiveOnly
        ? settings.greenhouseBoards
            .map((board) => ({ source: "Greenhouse", board }))
            .concat(
              settings.leverBoards.map((board) => ({ source: "Lever", board })),
            )
        : []),
    ];
  toast(
    `Refreshing ${sources.length} source${sources.length === 1 ? "" : "s"}…`,
  );
  let updated = 0;
  const errors = [];
  for (const source of sources) {
    try {
      const result = await api("/jobs/sync", source);
      if (result.cached) toast(result.message);
      else updated += result.count;
    } catch (e) {
      errors.push(
        `${source.source}${source.board ? ` (${source.board})` : ""}: ${e.message}`,
      );
    }
  }
  await reload();
  render();
  if (updated) toast(`${updated} listings refreshed.`);
  if (errors.length) toast(errors.join(" "), true);
}
async function uploadResume(file) {
  if (!file) return;
  if (file.size > 5_000_000) throw new Error("Choose a résumé under 5 MB.");
  const raw = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const b of raw) binary += String.fromCharCode(b);
  const result = await api("/resume", {
    name: file.name,
    base64: btoa(binary),
  });
  await reload();
  render();
  modal(
    "Your résumé is ready for a review.",
    `<div class="file-card">${icon("file")}<div><strong>${h(result.name)}</strong><p>File saved to your workspace.</p></div></div>${result.warning ? `<div class="banner warning"><span>${h(result.warning)}</span></div>` : ""}<p>We found the following details in your résumé. Choose what to add to your saved profile, then check your target roles and interests.</p><form id="resume-suggestions-form" class="mt stack">${result.suggestions.email ? `<label class="checkbox-label"><input name="email" type="checkbox" value="${h(result.suggestions.email)}"><span>Use email: ${h(result.suggestions.email)}</span></label>` : ""}${result.suggestions.skills.length ? `<label class="checkbox-label"><input type="checkbox" name="skills" value="${h(result.suggestions.skills.join(", "))}" checked><span>Add detected skills: ${h(result.suggestions.skills.join(", "))}</span></label>` : '<p class="hint">No recognized skills found. You can enter any skills in your profile.</p>'}<div class="modal-actions"><button class="btn" type="button" data-action="close-modal">Keep my current profile</button><button class="btn primary" type="submit">Use selected details</button></div></form>`,
  );
}

const actions = {
  menu: () => $(".sidebar").classList.toggle("open"),
  "close-modal": closeModal,
  "go-jobs": () => navigate("jobs"),
  "go-connections": () => navigate("connections"),
  "go-outreach": () => navigate("outreach"),
  "add-job": addJobModal,
  "job-detail": jobDetail,
  "app-detail": appDetail,
  fresh: () => resetModal(false),
  demo: () => resetModal(true),
  "confirm-reset": async (value) => {
    await api("/workspace/reset", { confirm: value });
    state.selectedJobs.clear();
    state.selectedContacts.clear();
    state.preview = null;
    closeModal();
    await reload();
    navigate(value === "START_FRESH" ? "profile" : "overview");
    toast(
      value === "START_FRESH"
        ? "A fresh start. Make this workspace yours."
        : "Sample workspace loaded.",
    );
  },
  "save-job": async (jid) => {
    const existing = state.data.applications.find((a) => a.jobId === jid);
    if (existing) return appDetail(existing.id);
    await api("/applications", { jobId: jid, stage: "Saved" });
    await reload();
    render();
    toast("Opportunity saved to your tracker.");
  },
  "prepare-one": async (jid) => {
    await api("/applications/batch", { jobIds: [jid] });
    await reload();
    render();
    appDetail(state.data.applications.find((a) => a.jobId === jid).id);
    toast(
      "Application prepared. Review your packet and apply on the employer website.",
    );
  },
  "prepare-batch": async () => {
    const result = await api("/applications/batch", {
      jobIds: [...state.selectedJobs],
    });
    state.selectedJobs.clear();
    await reload();
    navigate("applications");
    toast(
      `${result.count} opportunities prepared. No applications were submitted.`,
    );
  },
  "job-tab": (value) => {
    state.jobTab = value;
    state.jobsLimit = 24;
    render();
  },
  "clear-jobs": () => {
    state.selectedJobs.clear();
    $("#job-results").innerHTML = jobResults();
  },
  "more-jobs": () => {
    state.jobsLimit += 24;
    $("#job-results").innerHTML = jobResults();
  },
  "apps-board": () => {
    state.appsView = "board";
    render();
  },
  "apps-list": () => {
    state.appsView = "list";
    render();
  },
  "sync-jobs": () => syncJobs(),
  "sync-remotive": () => syncJobs(true),
  "import-contacts": importContactsModal,
  "apollo-search": apolloModal,
  "add-contact": () =>
    modal(
      "A new connection",
      `<form id="add-contact-form" class="stack"><div class="form-grid"><label class="field">Full name<input class="input" name="name" required maxlength="150"></label><label class="field">Work email<input class="input" name="email" type="email" required></label><label class="field">Company<input class="input" name="company" maxlength="150"></label><label class="field">Role<input class="input" name="title" maxlength="150"></label></div><p class="hint">Manual contacts are unverified. You can preview or download drafts. Use a provider-verified CSV for live sending.</p><div class="modal-actions"><button class="btn primary" type="submit">Add contact</button></div></form>`,
    ),
  "suppress-contact": async (cid) => {
    const c = state.data.contacts.find((c) => c.id === cid);
    await api(`/contacts/${cid}`, { suppressed: !c.suppressed }, "PATCH");
    await reload();
    render();
    toast(
      c.suppressed ? "Contact restored." : "Contact suppressed from outreach.",
    );
  },
  "enrich-contact": (cid) =>
    modal(
      "Enrich this work contact?",
      `<p>Apollo may charge credits for the information returned. Orbit requests a work email and does not request personal emails or phone numbers. Check your Apollo plan for the exact credit cost.</p><div class="modal-actions">${btn("Cancel", "close-modal")}${btn("Enrich with Apollo", "confirm-enrich", { id: cid, cls: "primary", icon: "sparkles" })}</div>`,
    ),
  "confirm-enrich": async (cid) => {
    const result = await api(`/contacts/${cid}/enrich`, {
      confirmCredits: true,
    });
    closeModal();
    await reload();
    render();
    toast(
      result.contact.email
        ? "Contact enriched. Review the provider email status."
        : "No work email was returned. The contact is still preview-only.",
    );
  },
  "save-apollo": async () => {
    const ids = $$('[name="apolloContact"]:checked').map((x) => x.value);
    if (!ids.length) throw new Error("Select at least one search result.");
    const r = await api("/contacts/apollo/save", { ids });
    closeModal();
    await reload();
    navigate("contacts");
    toast(
      `${r.added} contacts saved. Enrich a selected contact to request its work email.`,
    );
  },
  "selected-outreach": () => navigate("outreach"),
  "insert-var": (key) => {
    const area = $("#campaign-body");
    area.setRangeText(
      `{{${key}}}`,
      area.selectionStart,
      area.selectionEnd,
      "end",
    );
    area.focus();
  },
  "preview-campaign": previewCampaign,
  "edit-campaign": (cid) => {
    const c = state.data.campaigns.find((c) => c.id === cid),
      form = $("#campaign-form");
    form.dataset.campaignId = cid;
    for (const key of ["name", "subject", "body"])
      form.elements[key].value = c[key];
    $$('[name=\"recipients\"]', form).forEach((el) => {
      el.checked = c.contactIds.includes(el.value);
    });
    form.elements.attachResume.checked = c.attachResume;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
    toast("Editing saved draft. Review again after making changes.");
  },
  "preview-person": (value) => {
    state.previewIndex = Number(value);
    campaignPreview();
  },
  "send-campaign": async (cid) => {
    if (!$("#approve-send")?.checked)
      throw new Error(
        "Review the recipient list and check the approval box first.",
      );
    const result = await api(`/campaigns/${cid}/send`, {
      previewId: state.preview.previewId,
      approved: true,
      confirmCount: state.preview.messages.length,
    });
    await reload();
    render();
    await previewCampaign(cid);
    toast(
      result.status === "Accepted by provider"
        ? "Messages accepted by the email provider. Delivery is not yet confirmed."
        : "The campaign needs attention. Check per-recipient results.",
      result.status !== "Accepted by provider",
    );
  },
  "import-email": () => {
    if (!state.data.applications.length)
      return toast(
        "Add an application before importing an email update.",
        true,
      );
    emailModal();
  },
  "accept-email": async (mid) => {
    await api(`/inbox/${mid}/accept`, {});
    await reload();
    render();
    toast("Reviewed update applied to your tracker.");
  },
  "dismiss-email": async (mid) => {
    await api(`/inbox/${mid}/dismiss`, {});
    await reload();
    render();
  },
  "remove-resume": () =>
    modal(
      "Remove your résumé?",
      `<p>The uploaded file and extracted text will be removed. Campaigns that require this attachment will need another file before they can be previewed or sent.</p><div class="modal-actions">${btn("Keep file", "close-modal")}${btn("Remove résumé", "confirm-remove-resume", { cls: "danger" })}</div>`,
    ),
  "confirm-remove-resume": async () => {
    await api("/resume", {}, "DELETE");
    closeModal();
    await reload();
    render();
    toast("Résumé removed.");
  },
  "resume-text": () =>
    modal(
      "Review the extracted text",
      `<p>Check that the extraction preserved the information you need. This text is stored with the original file; job ranking uses the skills and target roles in your saved profile.</p><form id="resume-text-form" class="mt stack"><label class="field">Résumé text<textarea name="text" rows="16" maxlength="100000">${h(state.data.resume?.text)}</textarea></label><div class="modal-actions"><button class="btn primary" type="submit">Save text</button></div></form>`,
      "wide",
    ),
};
function resetModal(demo) {
  modal(
    demo ? "Explore the sample workspace?" : "Make room for your next chapter.",
    `<p>This replaces the current profile, uploaded résumé, jobs, applications, contacts, email updates, and campaigns${demo ? " with fictional sample data" : " with an empty workspace"}. Export your applications first if you want to keep them.</p><div class="modal-actions">${btn("Keep my workspace", "close-modal")}${btn(demo ? "Load sample workspace" : "Start fresh", "confirm-reset", { id: demo ? "LOAD_DEMO" : "START_FRESH", cls: "primary" })}</div>`,
  );
}

document.addEventListener("click", async (e) => {
  const route = e.target.closest("[data-route]");
  if (route) {
    if ($("#modal").open) closeModal();
    navigate(route.dataset.route);
    return;
  }
  const button = e.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const action = actions[button.dataset.action];
  if (!action) return;
  try {
    const result = action(button.dataset.id, e);
    if (result?.then) {
      button.disabled = true;
      await result;
    }
  } catch (err) {
    toast(err.message, true);
  } finally {
    button.disabled = false;
  }
});
document.addEventListener("input", (e) => {
  if (e.target.dataset.filter) {
    state.jobFilter[e.target.dataset.filter] = e.target.value;
    state.jobsLimit = 24;
    $("#job-results").innerHTML = jobResults();
  }
  if (e.target.id === "contact-search") {
    state.contactQuery = e.target.value;
    $("#contacts-table").innerHTML = contactsTable();
  }
});
document.addEventListener("change", async (e) => {
  try {
    if (e.target.dataset.jobSelect) {
      e.target.checked
        ? state.selectedJobs.add(e.target.dataset.jobSelect)
        : state.selectedJobs.delete(e.target.dataset.jobSelect);
      $("#job-results").innerHTML = jobResults();
    }
    if (e.target.dataset.contactSelect) {
      e.target.checked
        ? state.selectedContacts.add(e.target.dataset.contactSelect)
        : state.selectedContacts.delete(e.target.dataset.contactSelect);
    }
    if (e.target.id === "select-all-contacts") {
      $$("[data-contact-select]").forEach((el) => {
        el.checked = e.target.checked;
        e.target.checked
          ? state.selectedContacts.add(el.dataset.contactSelect)
          : state.selectedContacts.delete(el.dataset.contactSelect);
      });
    }
    if (e.target.id === "app-stage") {
      state.appStage = e.target.value;
      render();
    }
    if (e.target.id === "resume-input") await uploadResume(e.target.files[0]);
    if (e.target.id === "contacts-file") {
      const f = e.target.files[0];
      if (f?.size > 2_000_000) throw new Error("Choose a CSV under 2 MB.");
      if (f) $("#csv-input").value = await f.text();
    }
  } catch (err) {
    toast(err.message, true);
  }
});
document.addEventListener("dragover", (e) => {
  if (e.target.closest("#resume-drop")) {
    e.preventDefault();
    $("#resume-drop").classList.add("dragover");
  }
});
document.addEventListener("dragleave", (e) => {
  if (e.target.closest("#resume-drop"))
    $("#resume-drop").classList.remove("dragover");
});
document.addEventListener("drop", async (e) => {
  if (!e.target.closest("#resume-drop")) return;
  e.preventDefault();
  $("#resume-drop").classList.remove("dragover");
  try {
    await uploadResume(e.dataTransfer.files[0]);
  } catch (err) {
    toast(err.message, true);
  }
});

document.addEventListener("submit", async (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;
  e.preventDefault();
  const submitter = e.submitter;
  if (submitter) submitter.disabled = true;
  const f = new FormData(form),
    v = Object.fromEntries(f.entries());
  try {
    switch (form.id) {
      case "profile-form":
        await api(
          "/profile",
          { ...v, skills: split(v.skills), interests: split(v.interests) },
          "PUT",
        );
        await reload();
        render();
        toast("Profile saved. Your job matches are updated.");
        break;
      case "connections-form":
        await api(
          "/settings",
          {
            greenhouseBoards: split(v.greenhouseBoards),
            leverBoards: split(v.leverBoards),
          },
          "PUT",
        );
        await reload();
        render();
        toast("Job sources saved. Refresh to import their published roles.");
        break;
      case "manual-job-form": {
        const result = await api("/jobs/manual", v);
        await api("/applications", { jobId: result.job.id, stage: v.stage });
        closeModal();
        await reload();
        navigate("applications");
        toast("Opportunity added to your tracker.");
        break;
      }
      case "application-form":
        await api(`/applications/${form.dataset.id}`, v, "PATCH");
        await reload();
        render();
        appDetail(form.dataset.id);
        toast("Application updated.");
        break;
      case "add-contact-form":
        await api("/contacts", v);
        closeModal();
        await reload();
        render();
        toast("Contact added.");
        break;
      case "import-contacts-form": {
        const r = await api("/contacts/import", { csv: v.csv });
        closeModal();
        await reload();
        render();
        modal(
          "Your contacts are in.",
          `<p>${r.imported} contacts imported · ${r.skipped} rows skipped.</p>${r.errors.length ? `<div class="error-box contact-import-results">${r.errors.map(h).join("<br>")}</div>` : ""}<div class="modal-actions">${btn("Done", "close-modal", { cls: "primary" })}</div>`,
        );
        break;
      }
      case "apollo-form": {
        const result = await api("/contacts/apollo/search", v);
        state.apolloResults = result.contacts;
        $("#apollo-results").innerHTML =
          `<div class="line"></div><h3>${result.contacts.length} people found</h3><div class="contact-list mt">${result.contacts.map((c) => `<label class="contact-row"><input type="checkbox" name="apolloContact" value="${c.id}"><div><strong>${h(c.name)}</strong><p>${h(c.title)} · ${h(c.company)}</p></div></label>`).join("")}</div>${result.contacts.length ? `<div class="modal-actions">${btn("Save selected contacts", "save-apollo", { cls: "primary" })}</div>` : '<p class="hint">Try another company or broader role titles.</p>'}`;
        break;
      }
      case "campaign-form": {
        const contactIds = f.getAll("recipients");
        if (!contactIds.length)
          throw new Error("Choose at least one recipient.");
        const result = await api(
          form.dataset.campaignId
            ? `/campaigns/${form.dataset.campaignId}`
            : "/campaigns",
          {
            name: v.name,
            subject: v.subject,
            body: v.body,
            contactIds,
            attachResume: f.has("attachResume"),
          },
          form.dataset.campaignId ? "PATCH" : "POST",
        );
        form.dataset.campaignId = result.campaign.id;
        await reload();
        if (submitter?.value === "preview")
          await previewCampaign(result.campaign.id);
        else {
          render();
          toast("Campaign draft saved. No emails were sent.");
        }
        break;
      }
      case "email-form": {
        await api("/inbox/analyze", v);
        closeModal();
        await reload();
        navigate("inbox");
        toast("Email analyzed. Review the suggestion before applying it.");
        break;
      }
      case "resume-suggestions-form": {
        const p = state.data.profile;
        await api(
          "/profile",
          {
            ...p,
            ...(f.has("email") ? { email: v.email } : {}),
            skills: f.has("skills")
              ? [...new Set([...p.skills, ...split(v.skills)])]
              : p.skills,
          },
          "PUT",
        );
        closeModal();
        await reload();
        render();
        toast("Selected details added. Review your profile and interests.");
        break;
      }
      case "resume-text-form":
        await api("/resume/text", v, "PUT");
        closeModal();
        await reload();
        toast("Résumé text saved.");
        break;
    }
  } catch (err) {
    toast(err.message, true);
  } finally {
    if (submitter) submitter.disabled = false;
  }
});
$("#modal").addEventListener("click", (e) => {
  if (e.target === $("#modal")) {
    const r = $("#modal").getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      closeModal();
  }
});
window.addEventListener("hashchange", () => {
  state.route = routeNames[location.hash.slice(1)]
    ? location.hash.slice(1)
    : "overview";
  render();
  window.scrollTo(0, 0);
});
async function boot() {
  try {
    const [data, integrations] = await Promise.all([
      api("/state"),
      api("/integrations"),
    ]);
    state.data = data;
    state.integrations = integrations;
    state.route = routeNames[location.hash.slice(1)]
      ? location.hash.slice(1)
      : "overview";
    render();
  } catch (err) {
    $("#app").innerHTML =
      `<div class="boot">${brand}<h2>Your workspace needs a moment.</h2><p>${h(err.message)}</p><p class="small muted">Check that the Orbit server is running, then reload the page.</p></div>`;
  }
}
boot();
