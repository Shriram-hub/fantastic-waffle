import React from 'react';
import { useApp, fmt } from '../../shared/workspace.jsx';
import { Panel, Empty, Badge, Button } from '../../shared/ui.jsx';

export function AutopilotActivity({compact=false}) {
  const {autopilot,go}=useApp();
  const items=autopilot?.activity || [];
  return <Panel title="Autopilot activity" subtitle={autopilot?.policy.enabled ? `${autopilot.reviewCount} pitches awaiting review · Next discovery ${fmt(autopilot.schedule?.next_run)}` : "Enable Autopilot in Automation to start scheduled discovery."}
    action={compact && <Button small onClick={()=>go('automation')}>Open Autopilot</Button>}>
    {items.slice(0,compact ? 5 : 15).map(a=><div className="task-item" key={a.id}><div className="spread"><strong>{a.message}</strong><Badge value={a.kind}/></div><p>{fmt(a.at)}</p></div>)}
    {!items.length && <Empty title="Your search can run in the background.">Matching roles, verified contacts, reviewable pitches, and send results will appear here.</Empty>}
  </Panel>;
}
