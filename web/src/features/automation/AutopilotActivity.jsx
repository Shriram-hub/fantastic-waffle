import React from 'react';
import {QueueNowButton} from '../../shared/QueueNowButton.jsx';
import { useApp, fmt } from '../../shared/workspace.jsx';
import { Panel, Empty, Badge, Button } from '../../shared/ui.jsx';

export function AutopilotActivity({compact=false}) {
  const {autopilot,go}=useApp();
  const items=autopilot?.activity || [];
  const f=autopilot?.funnel;
  return <Panel title="Live activity" subtitle={autopilot?.policy.enabled ? `${autopilot.reviewCount} pitches awaiting review · Next outreach search ${fmt(autopilot.schedule?.next_run)}` : "Job search runs independently. Enable outreach to prepare company-specific pitches."}
    action={compact && <Button small onClick={()=>go('automation')}>Open Autopilot</Button>}>
    {!compact && <div className="btn-row mb"><QueueNowButton/></div>}
    {f && !compact && <div className="autopilot-funnel" aria-label="Actual workspace totals">{[[f.jobs,'Live jobs'],[f.highMatches,'High matches'],[f.domains,'Domains resolved'],[Object.values(f.contacts).reduce((a,b)=>a+b,0),'Contacts saved'],[f.scheduled,'Emails scheduled'],[f.sent,'Provider accepted']].map(([count,label])=><div key={label}><strong>{count}</strong><span>{label}</span></div>)}<p className="small muted">Contacts: {f.contacts.apollo} Apollo · {f.contacts.hunter} Hunter · {f.contacts.public} public candidates. Public candidates need verification.</p></div>}
    {items.slice(0,compact ? 5 : 15).map(a=><div className="task-item" key={a.id}><div className="spread"><strong>{a.message}</strong><Badge value={a.kind}/></div><p>{fmt(a.at)}</p></div>)}
    {!items.length && <Empty title="Your search can run in the background.">Matching roles, verified contacts, reviewable pitches, and send results will appear here.</Empty>}
  </Panel>;
}
