import React,{useEffect,useState} from 'react';
import {useApp,api} from './workspace.jsx';
import {Button,Heading} from './ui.jsx';
import {Overview} from '../features/overview/Overview.jsx';
import {Jobs} from '../features/jobs/Jobs.jsx';
import {CompanyExplorer} from '../features/jobs/CompanyExplorer.jsx';
import {Applications} from '../features/tracker/Applications.jsx';
import {QuickMassMailer} from '../features/outreach/QuickMassMailer.jsx';
import {ContactDiscovery} from '../features/outreach/ContactDiscovery.jsx';
import {BulkHarvest} from '../features/outreach/BulkHarvest.jsx';
import {Contacts} from '../features/outreach/Contacts.jsx';
import {Outreach} from '../features/outreach/Outreach.jsx';
import {Inbox} from '../features/tracker/Inbox.jsx';
import {Profile} from '../features/resume/Profile.jsx';
import {TailoredDocuments} from '../features/resume/TailoredDocuments.jsx';
import {CareerWorkspace} from '../features/career/CareerWorkspace.jsx';
import {Connections} from '../features/connections/Connections.jsx';
import {ProviderKeys} from '../features/connections/ProviderKeys.jsx';
import {AlertSettings} from '../features/connections/AlertSettings.jsx';
import {WorkspaceAppearance} from '../features/connections/WorkspaceAppearance.jsx';
import {SetupChecklist} from '../features/connections/SetupChecklist.jsx';
import {AutopilotSettings} from '../features/automation/AutopilotSettings.jsx';
import {AutopilotActivity} from '../features/automation/AutopilotActivity.jsx';
import {Automation} from '../features/automation/Automation.jsx';
import {QueueNowButton,WorkerStatus} from './QueueNowButton.jsx';

function FocusViews({label,items}){const [selected,setSelected]=useState(items[0][0]);return <><div className="focus-switch" role="group" aria-label={label}>{items.map(([key,title])=><Button key={key} active={selected===key} onClick={()=>setSelected(key)}>{title}</Button>)}</div>{items.find(([key])=>key===selected)?.[2]}</>;}
function FindContacts(){const {data,tasks}=useApp(),[status,setStatus]=useState(null);const signature=tasks.tasks.filter(t=>t.kind.startsWith('contacts.')).map(t=>`${t.id}:${t.status}`).join();async function refresh(){try{setStatus(await api('/contacts/discovery'));}catch{}}useEffect(()=>{refresh();},[signature,data.contacts.length]);return <><Heading title="Find contacts" subtitle="Choose a focused company search or a multi-company harvest."/><FocusViews label="Contact search mode" items={[["company","Company search",<ContactDiscovery showBulk={false}/>],["bulk","Multi-company harvest",<BulkHarvest status={status} onQueued={refresh}/>]]}/></>;}
function Activity(){return <><Heading title="Activity & health" subtitle="Live worker status and the recorded automation timeline."><WorkerStatus/><QueueNowButton/></Heading><AutopilotActivity/></>;}
function Autopilot(){return <><Heading title="Autopilot rules & review" subtitle="Rules, activity and worker queues each have their own focused view."/><FocusViews label="Autopilot tools" items={[["rules","Rules & approvals",<AutopilotSettings showActivity={false} showSources={false}/>],["activity","Activity",<AutopilotActivity/>],["queues","Worker queues",<Automation showSettings={false}/>]]}/></>;}
function Appearance(){return <><Heading title="Alerts, appearance & setup"/><FocusViews label="Workspace preferences" items={[["alerts","Alerts",<AlertSettings/>],["appearance","Appearance",<WorkspaceAppearance/>],["setup","Setup checklist",<SetupChecklist/>]]}/></>;}
export const focusedRoutes=['overview','overview-telemetry','jobs','companies','applications','outreach','contact-search','contacts','campaigns','inbox','profile','documents','career','stories','connections','provider-keys','automation','appearance'];
export function WorkspaceView({route}){switch(route){
  case 'overview-telemetry':return <Activity/>;case 'jobs':return <Jobs/>;case 'companies':return <CompanyExplorer/>;case 'applications':return <Applications/>;case 'outreach':return <QuickMassMailer/>;case 'contact-search':return <FindContacts/>;case 'contacts':return <Contacts showDiscovery={false}/>;case 'campaigns':return <Outreach mode="sequences"/>;case 'inbox':return <Inbox/>;case 'profile':return <Profile/>;case 'documents':return <TailoredDocuments/>;case 'career':return <CareerWorkspace focus="prep"/>;case 'stories':return <CareerWorkspace focus="stories"/>;case 'connections':return <Connections section="mailbox"/>;case 'provider-keys':return <><Heading title="API keys & quotas"/><ProviderKeys/></>;case 'automation':return <Autopilot/>;case 'appearance':return <Appearance/>;default:return <Overview/>;
}}
