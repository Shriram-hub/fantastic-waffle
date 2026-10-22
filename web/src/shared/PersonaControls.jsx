import React from 'react';
import {Field} from './ui.jsx';
export const personas=[['all','All Recommended'],['manager','🎯 Functional Hiring Managers'],['hiring-poster','🔥 Active #Hiring Posters'],['peer','🎓 Warm Alumni & Peers'],['recruiter','📋 HR & Talent Acquisition']];
export const angles=[['auto','Adapt to each contact'],['value','Value / Work-Sample Pitch'],['referral','10-Minute Advice / Referral Ask'],['application','Direct Application / Role-Fit Summary']];
export function PersonaFilter({value,onChange}) {
  return <Field label="Target persona"><select value={value} onChange={e=>onChange(e.target.value)}>{personas.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field>;
}
export function PitchAngle({value,onChange}) {
  return <Field label="Email & LinkedIn draft angle"><select value={value} onChange={e=>onChange(e.target.value)}>{angles.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field>;
}
export function EmailPattern({pattern,domain}) {
  if(!pattern?.pattern)return null;
  return <p className="pattern-badge"><span className="mono">{pattern.pattern}@{domain}</span><span>{pattern.status || 'observed'} format · {pattern.sampleCount || 1} named {pattern.sampleCount===1?'sample':'samples'}</span><small>Address format only · each mailbox still needs verification</small></p>;
}
export function PersonaBadge({contact}) {
  const label=personas.find(([key])=>key===contact.persona)?.[1];
  return <div className="persona-badges">{label && <span className="badge">{label}</span>}{contact.activeHiringPoster && <a className="badge hiring-signal" href={contact.hiringPost?.url} target="_blank" rel="noreferrer">🔥 Active Hiring Poster · +25</a>}{contact.reportingMatch && <span className="badge">Published reporting-line match</span>}{Number.isFinite(contact.priorityScore) && <span className="mono tiny">Priority {contact.priorityScore}</span>}</div>;
}
