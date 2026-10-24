import {WorkspaceView} from './shared/WorkspaceView.jsx';
import {WorkspaceTabs} from './shared/WorkspaceTabs.jsx';
import {SlideOver} from './shared/SlideOver.jsx';
import {handleTriageShortcut,TRIAGE_SHORTCUTS} from './shared/commands.mjs';
import {contactHandoff} from './shared/contact-handoff.mjs';
import {CompanyExplorer} from './features/jobs/CompanyExplorer.jsx';
import React, { useEffect, useState, useRef, useCallback } from 'react';
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
import {navGroups,names,navigationCount,workspaceFor} from './shared/navigation.mjs';
import {CommandPalette} from './shared/CommandPalette.jsx';
import {applyTheme,applyBrand,savedPreference,DEFAULT_BRAND} from './shared/theme.mjs';
import {WorkerStatus} from './shared/QueueNowButton.jsx';
import {TailoredDocuments} from './features/resume/TailoredDocuments.jsx';
import {Icon,BrandMark} from './shared/Icon.jsx';
import {SignIn,WorkspaceError,authMessages} from './features/auth/SignIn.jsx';
import {workspaceLoader,connectWorkspaceEvents} from './shared/workspace-loader.mjs';
export default function App() {
  const [theme,setTheme]=useState(()=>savedPreference('veloce-theme','dark'));
  const [collapsed,setCollapsed]=useState(()=>savedPreference('veloce-sidebar','expanded')==='collapsed');
  const [dailySprint,setDailySprint]=useState(null),[discoveryTarget,setDiscoveryTarget]=useState(null),[shortcuts,setShortcuts]=useState(false),triageApp=useRef(null);
  const [palette,setPalette]=useState(false),[worker,setWorker]=useState({status:'offline'});
  const toggleTheme=()=>setTheme(t=>t==='dark' ? 'light' : 'dark');
  useEffect(()=>applyTheme(theme),[theme]);
  useEffect(()=>{try{localStorage.setItem('veloce-sidebar',collapsed ? 'collapsed' : 'expanded');}catch{}},[collapsed]);
  const [careerJobId,setCareerJobId]=useState(''),[careerMockStart,setCareerMockStart]=useState(false),[mailerCompany,setMailerCompany]=useState(''),[mailerSelection,setMailerSelection]=useState(null);
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
    [route, setRoute] = useState(location.hash.slice(1).split('?')[0] || "jobs"),
    [modal, setModal] = useState(null),
    [notice, setNotice] = useState(null),
    [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState(false),
    [error, setError] = useState(null);
  const notify = (message, error = false) => setNotice({ message, error });
  const loader=useRef(null);
  if(!loader.current)loader.current=workspaceLoader(async()=>{
    const s=await api('/bootstrap');
    setData(previous=>s.data.jobFeed?.truncated && previous ? mergeFeedCache(s.data,previous.jobs) : s.data);setIntegrations(s.integrations);setAccounts(s.accounts);
    setTasks(s.tasks);setWorker(s.worker || {status:'offline'});setVault(s.vault);setAutopilot(s.autopilot);setSearch(s.search);setSetup(s.setup);
    setError(null);
  });
  const cacheJobs=useCallback(jobs=>setData(previous=>previous ? mergeFeedCache(previous,jobs,true) : previous),[]);
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
    const listen = () => setRoute(location.hash.slice(1).split('?')[0] || "jobs");
    window.addEventListener("hashchange", listen);
    listen(); // Capture a deep link changed while the session was loading.
    let refreshTimer;
    const refresh=()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>reloadRef.current({fresh:true}).catch(()=>{}),200);};
    const decode=fn=>event=>{try{fn(JSON.parse(event.data));}catch{}};
    const disconnect=connectWorkspaceEvents({onConnection:setConnected,handlers:{
      ready:()=>reloadRef.current().catch(()=>{}),
      'auth-required':()=>window.dispatchEvent(new Event('orbit:auth-required')),
      worker:decode(value=>{setWorker(value);setConnected(true);}),
      unavailable:()=>{setConnected(false);setWorker({status:'offline'});},
      task:decode(task=>{if(task.kind==='resume.parse' && task.status==='completed')notify('Résumé ready. Matching jobs are being discovered.');if(['failed','unknown'].includes(task.status))notify('A background task needs attention. Check Autopilot.',true);refresh();}),
      autopilot:decode(item=>{if(['review','queued','blocked'].includes(item.kind))notify(item.message,item.kind==='blocked');refresh();}),
      search:refresh
    }});
    return () => {
      window.removeEventListener("hashchange", listen);
      disconnect();
      clearTimeout(refreshTimer);
    };
  }, [session?.authenticated]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 9000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(()=>{
    const key=event=>{if(event.repeat)return;if((event.metaKey || event.ctrlKey) && event.key.toLowerCase()==='k'){event.preventDefault();if(session?.authenticated){setModal(null);setPalette(v=>!v);}}if(event.key==='Escape')setMobile(false);};
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[session?.authenticated]);
  useEffect(()=>{if(!data)return;const ids=contactHandoff(location.hash,data.contacts);if(ids?.length){setMailerSelection({ids,at:Date.now()});setRoute('outreach');history.replaceState(null,'','#outreach');}},[data?.contacts]);
  useEffect(()=>{const key=event=>{if(session?.authenticated && triageApp.current)handleTriageShortcut(event,triageApp.current,{showHelp:()=>setShortcuts(true)});};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[session?.authenticated]);
  useEffect(()=>applyBrand(data?.settings?.brand),[data?.settings?.brand?.name,data?.settings?.brand?.accent]);
  if(session && !session.authenticated)return <SignIn session={session} initialError={authError} onSignedIn={checkSession}/>;
  if (error && !data)return <WorkspaceError message={error.message} reference={error.reference} busy={retrying} onRetry={()=>session ? (setRetrying(true),reload().catch(setError).finally(()=>setRetrying(false))) : checkSession()}/>;
  if (!data)
    return (
      <div className="loading">
        <BrandMark size={48}/><span className="logo-word">Veloce</span>
        <p>Getting your workspace ready…</p>
      </div>
    );
  const app = {
    dailySprint,setDailySprint,discoveryTarget,setDiscoveryTarget,cacheJobs,careerJobId,setCareerJobId,careerMockStart,setCareerMockStart,mailerCompany,setMailerCompany:value=>{setMailerCompany(value);setMailerSelection(null);},mailerSelection,setMailerSelection,theme,toggleTheme,worker,connected,
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
  triageApp.current=app;
  const activeWorkspace=workspaceFor(route);
  const brand={...DEFAULT_BRAND,...data.settings.brand};if(brand.name==='Veloce AI')brand.name=DEFAULT_BRAND.name;
  const mailbox=accounts[0];
  return <Context.Provider value={app}>
    <a className="skip-link" href="#main" onClick={e=>{e.preventDefault();document.getElementById('main')?.focus();}}>Skip to content</a>
    <div className={`layout ${collapsed ? 'is-collapsed' : ''}`}>
      {mobile && <button className="nav-backdrop" aria-label="Close navigation" onClick={()=>setMobile(false)}/>}
      <aside className={`sidebar ${mobile ? 'open' : ''}`}>
        <div className="brand"><BrandMark/><div className="brand-copy"><strong>{brand.name}</strong><small>CANDIDATE PIPELINE</small></div><button className="icon-button collapse-sidebar" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} onClick={()=>setCollapsed(v=>!v)}><Icon name="sidebar"/></button></div>
        <button className="workspace-switch" onClick={()=>go('connections')} title="Workspace settings"><span className="workspace-mark">{(data.profile.name || 'My').slice(0,1)}</span><span className="workspace-copy"><strong>{data.profile.name ? `${data.profile.name.split(' ')[0]}’s workspace` : 'My workspace'}</strong><small>{data.isDemo ? 'Sample environment' : 'Personal workspace'}</small></span><span className="workspace-arrow">⌄</span></button>
        <div className="nav-scroll"><nav className="nav" aria-label="Workspace">{navGroups.map(group=><div className="nav-group" key={group.label}>{group.routes.map(key=>{const count=navigationCount(key,app);return <button key={key} className={`nav-item ${activeWorkspace.id===key ? 'active' : ''}`} onClick={()=>go(key)} aria-current={activeWorkspace.id===key ? 'page' : undefined} title={group.label} aria-label={group.label}><Icon name={key}/><span className="nav-name">{group.label}</span>{count>0 && <span className="nav-count">{count>999 ? '999+' : count}</span>}</button>;})}</div>)}</nav></div>
        <button className="sidebar-command" onClick={()=>setPalette(true)} title="Search workspace"><Icon name="command"/><span>Search anything</span><kbd>⌘ K</kbd></button>
        <div className="profile-mini"><span className="avatar">{data.profile.name?.split(' ').map(x=>x[0]).slice(0,2).join('') || 'ME'}</span><button onClick={()=>go('profile')}><strong>{data.profile.name || 'Complete your profile'}</strong><small>{accounts.length ? 'Mailbox connected' : 'Connect a mailbox'}</small></button><span className={`status-dot ${connected ? '' : 'warning'}`} title={connected ? 'Live updates connected' : 'Live updates reconnecting'}/></div>
      </aside>
      <div className="main-shell" inert={mobile ? true : undefined}><header className="topbar">
        <div className="topbar-location"><button className="icon-button mobile-only" onClick={()=>setMobile(v=>!v)} aria-label="Toggle navigation" aria-expanded={mobile}><Icon name="sidebar"/></button><span className="crumb"><span>Workspace</span><span className="crumb-divider">/</span><strong>{names[route] || 'Overview'}</strong></span></div>
        <div className="topbar-actions"><WorkerStatus/><button className="command-trigger" onClick={()=>setPalette(true)} aria-label="Open command palette"><Icon name="jobs" size={16}/><span>Search</span><kbd>⌘ K</kbd></button><button className="provider-pill" title={mailbox ? `${mailbox.email} · ${setup.aiConfigured ? setup.geminiConfigured ? 'Gemini configured' : 'AI configured' : 'AI not configured'}` : 'Connect your mailbox and model provider'} onClick={()=>go('connections')}><span className={`status-dot ${mailbox ? '' : 'warning'}`}/><span>{mailbox ? mailbox.provider==='google' ? 'Gmail' : 'Outlook' : 'No mailbox'}<span className="pill-divider">/</span>{setup.aiConfigured ? setup.geminiConfigured ? 'Gemini' : 'Model ready' : 'No model'}</span></button><button className="icon-button theme-toggle" aria-label={`Switch to ${theme==='dark' ? 'light' : 'dark'} mode`} title={`Switch to ${theme==='dark' ? 'light' : 'dark'} mode`} onClick={toggleTheme}><Icon name={theme==='dark' ? 'sun' : 'moon'}/></button>{session?.googleConfigured && session.method==='password' && <a className="link-google" href="/api/auth/google/start">{session.googleLinked ? 'Use Google' : 'Link Google'}</a>}{session?.required && <button className="icon-button sign-out" onClick={signOut} title="Sign out" aria-label="Sign out"><Icon name="arrow"/></button>}</div>
      </header><main id="main" tabIndex={-1}>
        {authError && <div className="banner" role="alert">{authError}<button onClick={()=>setAuthError('')}>Dismiss</button></div>}
        {data.isDemo && <div className="banner"><span><strong>Sample workspace.</strong> Jobs, contacts, and events are fictional.</span><button onClick={()=>setModal({type:'reset',demo:false})}>Start my workspace →</button></div>}
        <WorkspaceTabs route={route} go={go}/><section className="focused-workspace" aria-label={names[route] || 'Overview'}><WorkspaceView key={route} route={route}/></section><footer className="page-footer"><span>{brand.name} <span className="footer-dot">·</span> Candidate Pipeline & Outbound Desk</span><span><span className={`status-dot ${connected ? '' : 'warning'}`}/>{connected ? 'Workspace synced' : 'Reconnecting live updates'}</span></footer>
      </main></div>
    </div>
    <SlideOver open={shortcuts} onClose={()=>setShortcuts(false)} title="Keyboard shortcuts"><dl className="shortcut-list">{TRIAGE_SHORTCUTS.map(([key,label])=><div key={key}><dt><kbd>{key}</kbd></dt><dd>{label}</dd></div>)}</dl><p className="hint">Shortcuts pause while typing or while a dialog is open.</p></SlideOver>
    {modal && <ModalContent modal={modal} close={()=>setModal(null)}/>}
    {palette && <CommandPalette close={()=>setPalette(false)}/>}
    {notice && <div className={`notification ${notice.error ? 'error' : ''}`} role="status"><span>{notice.message}</span><button onClick={()=>setNotice(null)} aria-label="Dismiss notification">×</button></div>}
  </Context.Provider>;
}

export { WorkspaceContext, stages, api } from './shared/workspace.jsx';
export { Button, Badge, Heading } from './shared/ui.jsx';
export { Overview, Jobs, Applications, Profile, Contacts, Outreach, Inbox, Automation, Connections, SignIn, WorkspaceError, CareerWorkspace };
export {CareerPlanner} from './features/career/CareerPlanner.jsx';
export {CareerPrep} from './features/career/CareerPrep.jsx';
export {MockInterviewModal} from './features/career/MockInterviewModal.jsx';
export {QuickMassMailer} from './features/outreach/QuickMassMailer.jsx';
export {CompanyExplorer};
export {StoryBank} from './features/career/StoryBank.jsx';

export {CommandPalette,TailoredDocuments,WorkspaceTabs,WorkspaceView};

function mergeFeedCache(state,jobs,newFirst=false) {
  const pinned=new Set([...state.applications,...state.contacts,...state.campaigns].map(item=>item.jobId));
  const seen=new Set(),merged=(newFirst?[...jobs,...state.jobs]:[...state.jobs,...jobs]).filter(job=>{if(seen.has(job.id))return false;seen.add(job.id);return true;});
  return {...state,jobs:merged.filter((job,index)=>index<1000 || pinned.has(job.id))};
}
