import React from 'react';
import {useApp} from '../../shared/workspace.jsx';
import {Heading,Button,Empty} from '../../shared/ui.jsx';
import {Icon} from '../../shared/Icon.jsx';
import {SetupChecklist} from '../connections/SetupChecklist.jsx';
import {SearchStatus} from '../jobs/SearchStatus.jsx';
import {JobCard} from '../jobs/JobCard.jsx';
import {AutopilotActivity} from '../automation/AutopilotActivity.jsx';
export function Overview() {
  const {data,search,go}=useApp(),live=data.jobs.filter(j=>!j.archived),personalized=search?.plan.personalized || !!data.profile.interests.length;
  const recommended=live.filter(j=>!personalized || j.match?.eligible!==false).sort((a,b)=>(b.match?.score || 0)-(a.match?.score || 0)).slice(0,4);
  const applied=data.applications.filter(a=>!['Saved','Ready'].includes(a.stage)).length;
  return <>
    <Heading title={data.profile.name ? `Welcome back, ${data.profile.name.split(' ')[0]}` : 'Your next opportunity starts here'} subtitle="Your search, applications, and conversations. One clear workspace."><Button primary onClick={()=>go('jobs')}>Explore your jobs<Icon name="arrow"/></Button></Heading>
    <SetupChecklist compact/><SearchStatus/>
    <div className="overview-stats">{[[live.length,'Live opportunities','jobs'],[search?.matches ?? '—','Match your preferences','spark'],[data.applications.filter(a=>a.stage==='Saved').length,'Saved to your tracker','bookmark'],[applied,'Applications in progress','applications']].map(([value,label,icon])=><div className="overview-stat" key={label}><span><Icon name={icon}/>{label}</span><strong>{value.toLocaleString()}</strong></div>)}</div>
    <div className="overview-main-grid"><section><div className="section-heading"><div><h2>{personalized ? 'Recommended for you' : 'Explore live opportunities'}</h2><p>{personalized ? 'The closest matches in your current search.' : 'Choose your target roles to personalize this list.'}</p></div><Button small onClick={()=>go('jobs')}>View all jobs</Button></div><div className="opportunities-list">{recommended.map(j=><JobCard key={j.id} job={j} compact/>)}</div>{!recommended.length && <Empty title="We’re building your feed">Set target roles in Discover jobs. New results appear automatically as sources finish.</Empty>}</section><aside><section className="insight-panel"><h2>Your application pipeline</h2>{['Saved','Ready','Applied','Assessment','Interview','Offer'].map(stage=><div className="pipeline-line" key={stage}><span>{stage}</span><strong>{data.applications.filter(a=>a.stage===stage).length}</strong></div>)}<Button small onClick={()=>go('applications')}>Open tracker</Button></section><section className="insight-panel"><h2>Outreach, when you’re ready</h2><p>Review job-specific pitches before sending, or enable a bounded automatic sequence.</p><Button small onClick={()=>go('automation')}>Open outreach settings</Button></section></aside></div>
    <AutopilotActivity compact/>
  </>;
}
