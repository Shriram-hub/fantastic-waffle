import React from 'react';
import {useApp} from '../../shared/workspace.jsx';
import {Icon} from '../../shared/Icon.jsx';
export function SetupChecklist({compact=false}) {
  const {data,search,setup={},accounts=[],go}=useApp();
  const steps=[
    {title:'Search preferences',done:!!search?.plan.personalized || !!data.profile.interests.length,description:'Roles and location start your automatic search.',route:'jobs',action:'Set target roles',required:true},
    {title:'Résumé & profile',done:!!data.resume?.text,description:data.resume ? data.resume.parseStatus==='queued' ? 'Reading your résumé…' : 'Review extracted text and skills.' : 'Improve matching with your skills and experience.',route:'profile',action:'Upload résumé'},
    {title:'Company contacts',done:setup.apolloConfigured || setup.hunterConfigured,description:setup.apolloConfigured || setup.hunterConfigured ? 'API key saved. Lookup tasks confirm provider access.' : 'Apollo or Hunter enables recruiter discovery.',route:'connections',action:'View connections'},
    {title:'Email account',done:!!accounts.length,description:accounts.length ? 'Mailbox connected.' : setup.googleConfigured || setup.microsoftConfigured ? 'OAuth credentials saved. Connect your account below.' : 'Add OAuth credentials to connect Gmail or Outlook.',route:'connections',action:'Connect mailbox'},
  ];
  return <section className="setup-checklist"><div className="setup-checklist-head"><div><h2>{compact ? 'Your setup at a glance' : 'Connection & setup status'}</h2><p>Job search works on its own. Contacts and email unlock outreach.</p></div><span>{steps.filter(s=>s.done).length}/{steps.length} complete</span></div><div className="setup-steps">{steps.map((s,i)=><button className={`setup-step ${s.done ? 'complete' : ''}`} key={s.title} onClick={()=>go(s.route)}><span className="setup-step-icon">{s.done ? <Icon name="check"/> : i+1}</span><div><strong>{s.title}{s.required && <small>Start here</small>}</strong><p>{s.description}</p><span>{s.done ? 'Review' : s.action} →</span></div></button>)}</div></section>;
}
