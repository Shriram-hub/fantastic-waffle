import React,{useEffect,useState} from 'react';
import {useApp,api} from '../../shared/workspace.jsx';
import {Heading,Button,Panel,Field} from '../../shared/ui.jsx';
import {CareerPlanner} from './CareerPlanner.jsx';
import {CareerPrep} from './CareerPrep.jsx';
import {StoryBank} from './StoryBank.jsx';

export function CareerWorkspace({focus}) {
  const {data,tasks,perform,careerJobId}=useApp(),[workspace,setWorkspace]=useState(null),[tab,setTab]=useState(focus || (careerJobId ? 'prep' : 'planner')),[error,setError]=useState(''),[goal,setGoal]=useState('');
  useEffect(()=>{if(focus)setTab(focus);},[focus]);
  const signature=JSON.stringify(tasks.tasks.filter(t=>t.kind==='career.prep').map(t=>[t.id,t.status,t.updated_at]));
  async function refresh(){try{setWorkspace(await api('/career'));setError('');}catch(e){setError(e.message);}}
  useEffect(()=>{const timer=setTimeout(refresh,150);return()=>clearTimeout(timer);},[data.careerSummary?.updatedAt,signature]);
  const tracked=new Set(data.applications.map(a=>a.jobId));
  const jobs=[...data.jobs].filter(j=>!j.archived || tracked.has(j.id)).sort((a,b)=>Number(tracked.has(b.id))-Number(tracked.has(a.id)) || (b.match?.score || 0)-(a.match?.score || 0)).slice(0,400);
  return <><Heading title="Make your next move count." subtitle="A clear plan, prepared conversations, and a view of your progress."><a className="btn" href="/api/career/calendar.ics">Export calendar</a></Heading>{focus!=='prep' && <div className="career-tabs" role="tablist" aria-label="Career workspace">{[['planner','Action planner'],['prep','Interview prep'],['stories','STAR stories'],['progress','Search analytics']].filter(([key])=>!focus || key!=='prep').map(([key,label])=><button role="tab" aria-selected={tab===key} key={key} onClick={()=>setTab(key)}>{label}</button>)}</div>}
    {error && <div className="notice" role="alert">{error}<Button small onClick={refresh}>Try again</Button></div>}
    {!workspace ? <p>Loading your career workspace…</p> : <>{tab==='planner' && <CareerPlanner workspace={workspace} jobs={jobs}/>} {tab==='prep' && <CareerPrep workspace={workspace} jobs={jobs}/>} {tab==='stories' && <StoryBank stories={workspace.stories}/>} {tab==='progress' && <><div className="contact-metrics career-stats">{[[workspace.stats.submitted,'Submitted applications'],[workspace.stats.interviews,'Reached interview'],[workspace.stats.offers,'Offers recorded'],[workspace.stats.overdue,'Overdue actions']].map(([count,label])=><div key={label}><strong>{count}</strong><span>{label}</span></div>)}</div><div className="career-columns"><Panel title="Your application pipeline" subtitle="Current stages from your tracker. Outcomes reflect recorded history.">{Object.entries(workspace.stats.stageCounts).map(([stage,count])=><div className="career-stage" key={stage}><span>{stage}</span><progress value={count} max={Math.max(workspace.stats.tracked,1)} aria-label={`${stage}: ${count} applications`}/><strong>{count}</strong></div>)}</Panel><form className="form-section" onSubmit={e=>{e.preventDefault();perform(()=>api('/career/preferences',{weeklyGoal:Number(goal || workspace.weeklyGoal)},'PATCH'),'Application target saved.');}}><h2>Build a steady search habit.</h2><strong className="goal-count">{workspace.stats.appliedLast7Days} / {workspace.weeklyGoal}</strong><p>Applications recorded as submitted in the last seven days. Prepared applications count when you submit them.</p><progress value={workspace.stats.appliedLast7Days} max={workspace.weeklyGoal} aria-label="Weekly application goal"/><Field label="Weekly application target"><input type="number" min="1" max="100" value={goal || workspace.weeklyGoal} onChange={e=>setGoal(e.target.value)}/></Field><Button primary type="submit">Save target</Button></form></div></>}</>}
  </>;
}
