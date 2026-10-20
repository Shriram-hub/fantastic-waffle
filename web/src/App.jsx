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
import {CareerWorkspace} from './features/career/CareerWorkspace.jsx';
import { ModalContent } from './features/modals/ModalContent.jsx';
import { symbols, names } from './shared/navigation.mjs';
import {Icon} from './shared/Icon.jsx';
import {SignIn,WorkspaceError,authMessages} from './features/auth/SignIn.jsx';
import {workspaceLoader} from './shared/workspace-loader.mjs';
export default function App() {
  const [careerJobId,setCareerJobId]=useState('');
  const [session,setSession]=useState(null),[retrying,setRetrying]=useState(false),[authError,setAuthError]=useState('');
  const [data, setData] = useState(null),
    [integrations, setIntegrations] = useState({}),
    [accounts, setAccounts] = useState([]),
    [tasks, setTasks] = useState({ tasks: [], applications: [] }),
    [vault, setVault] = useState({ versions: [], links: [] }),
    [autopilot, setAutopilot] = useState(null),
    [search,setSearch] = useState(null),
    [setup,setSetup] = useState({}),
    [connected,setConnected] = useState(false),
    [route, setRoute] = useState(location.hash.slice(1) || "jobs"),
    [modal, setModal] = useState(null),
    [notice, setNotice] = useState(null),
    [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState(false),
    [error, setError] = useState(null);
  const notify = (message, error = false) => setNotice({ message, error });
  const loader=useRef(null);
  if(!loader.current)loader.current=workspaceLoader(async()=>{
    const s=await api('/bootstrap');
    setData(s.data);setIntegrations(s.integrations);setAccounts(s.accounts);
    setTasks(s.tasks);setVault(s.vault);setAutopilot(s.autopilot);setSearch(s.search);setSetup(s.setup);
    setError(null);
  });
  const reload=options=>loader.current(options);
  async function checkSession() {
    setRetrying(true);setError(null);
    try{const value=await api('/auth/session');setSession(value);}catch(e){setError(e);}finally{setRetrying(false);}
  }
  async function signOut() {
    try{await api('/auth/logout',{});setData(null);await checkSession();}catch(e){notify(e.message,true);}
  }
  async function perform(fn, message) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await reload({fresh:true});
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
    const query=new URLSearchParams(location.search),code=query.get('auth_error');
    if(code){setAuthError(authMessages[code] || authMessages.google_failed);query.delete('auth_error');history.replaceState(null,'',`${location.pathname}${query.size ? `?${query}` : ''}${location.hash}`);}
    checkSession();
    const expired=()=>{setData(null);setSession(previous=>({...previous,authenticated:false}));};
    window.addEventListener('orbit:auth-required',expired);
    return()=>window.removeEventListener('orbit:auth-required',expired);
  },[]);
  useEffect(() => {
    if(!session?.authenticated)return;
    reload().catch(setError);
    const listen = () => setRoute(location.hash.slice(1) || "jobs");
    window.addEventListener("hashchange", listen);
    const events = new EventSource('/api/events');
    events.addEventListener('auth-required',()=>window.dispatchEvent(new Event('orbit:auth-required')));
    let refreshTimer;
    events.addEventListener('ready', () => {setConnected(true);reloadRef.current().catch(() => {});});
    events.onerror=()=>setConnected(false);
    events.addEventListener('task', (event) => {
      const task = JSON.parse(event.data);
      if (task.kind==='resume.parse' && task.status==='completed') notify('Résumé ready. Matching jobs are being discovered.');
      if (['failed','unknown'].includes(task.status)) notify('A background task needs attention. Check Automation.',true);
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => reloadRef.current({fresh:true}).catch(() => {}), 150);
    });
    events.addEventListener('autopilot', (event) => {
      const item = JSON.parse(event.data);
      if(['review','queued','blocked'].includes(item.kind)) notify(item.message,item.kind==='blocked');
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => reloadRef.current({fresh:true}).catch(() => {}), 150);
    });
    events.addEventListener('search',()=>{
      clearTimeout(refreshTimer);
      refreshTimer=setTimeout(()=>reloadRef.current({fresh:true}).catch(()=>{}),350);
    });
    return () => {
      window.removeEventListener("hashchange", listen);
      events.close();
      clearTimeout(refreshTimer);
    };
  }, [session?.authenticated]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 9000);
    return () => clearTimeout(timer);
  }, [notice]);
  if(session && !session.authenticated)return <SignIn session={session} initialError={authError} onSignedIn={checkSession}/>;
  if (error && !data)return <WorkspaceError message={error.message} reference={error.reference} busy={retrying} onRetry={()=>session ? (setRetrying(true),reload().catch(setError).finally(()=>setRetrying(false))) : checkSession()}/>;
  if (!data)
    return (
      <div className="loading">
        <span className="logo-word">orbit</span>
        <p>Getting your workspace ready…</p>
      </div>
    );
  const app = {
    careerJobId,setCareerJobId,
    data,
    integrations,
    accounts,
    tasks,
    vault,
    autopilot,
    search,setup,
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
      career:CareerWorkspace,
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
            <small>CAREER WORKSPACE</small>
          </div>
          <div className="workspace-switch">
            <span className="workspace-mark">O</span>
            <div>
              Your career, in motion
              <p className="muted tiny">
                {data.isDemo ? "Fictional sample data" : "Personal workspace"}
              </p>
            </div>
          </div>
          <div className="nav-scroll">
            <p className="nav-label">WORKSPACE</p>
            <nav className="nav" aria-label="Workspace">
              {[
                "jobs",
                "overview",
                "applications",
                "career",
                "profile",
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
                  <Icon name={key}/>
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
                <Icon name="connections"/>Connections & setup
              </button>
            </div>
          </div>
          <div className="sidebar-spacer" />
          <div className="help-box">
            <span className="help-eyebrow"><span className="status-dot"/>AUTOMATIC DISCOVERY</span>
            <strong>Your search keeps going.</strong>
            <p>Set your roles once. Orbit checks public feeds and company boards every two hours.</p>
            <Button small onClick={() => go('jobs')}>
              Customize your search
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
              {session?.googleConfigured && session.method==='password' && <a className="btn small" href="/api/auth/google/start">{session.googleLinked ? 'Use Google account' : 'Link Google sign-in'}</a>}
              {session?.required && <Button small onClick={signOut}>Sign out</Button>}
              <span className={`connection-indicator ${connected ? 'online' : ''}`}><span className="status-dot"/>{connected ? 'Live updates' : 'Connecting…'}</span>
              <span className="muted">
                {new Date().toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </span>
              <Button small onClick={() => go("connections")}>
                <Icon name="connections"/>{busy ? "Working…" : "Connection status"}
              </Button>
            </div>
          </header>
          <main id="main" tabIndex={-1}>
            {authError && <div className="banner" role="alert">{authError}<button onClick={()=>setAuthError('')}>Dismiss</button></div>}
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
              Orbit v0.5 · Your personal career workspace
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
export { Overview, Jobs, Applications, Profile, Contacts, Outreach, Inbox, Automation, Connections, SignIn, WorkspaceError, CareerWorkspace };
export {CareerPlanner} from './features/career/CareerPlanner.jsx';
export {CareerPrep} from './features/career/CareerPrep.jsx';
export {StoryBank} from './features/career/StoryBank.jsx';
