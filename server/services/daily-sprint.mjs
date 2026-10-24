import {id,hash,now,fail,emailValid} from '../domain.mjs';
import {startJobPitch} from './job-pitch.mjs';
import {getSearchConfig} from './discovery.mjs';
import {buildSearchPlan,rankOpportunity} from './search-plan.mjs';
import {queryCatalog,retainCatalogJob} from './job-catalog.mjs';
const profileHash=state=>hash([state.profile,state.resume?.contentHash || state.resume?.text]);
const pending=new WeakMap();
// Serialize starts in the API process; task and per-job queue keys also persist.
export async function startDailySprint(data,store,queue,config={}){
  const previous=pending.get(store) || Promise.resolve();
  const run=previous.catch(()=>{}).then(()=>prepareSprint(data,store,queue,config));pending.set(store,run);
  try{return await run;}finally{if(pending.get(store)===run)pending.delete(store);}
}
async function prepareSprint(data,store,queue,config){
  await store.refresh();const s=store.state;
  if(s.isDemo || !s.resume?.text || !s.profile.name || !emailValid(s.profile.email || ''))fail('Save your name, email and readable resume before starting a sprint.');
  const plan=buildSearchPlan(s,await getSearchConfig(store));if(!plan.personalized)fail('Set your target roles before starting a sprint.');
  const timeZone=s.settings.sendTimeZone || 'UTC';let date;try{date=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(Date.now());}catch{date=now().slice(0,10);}
  const signature=hash([date,profileHash(s),plan.scope]),runs=s.settings.dailySprintRuns || [],old=runs.find(r=>r.signature===signature);if(old)return {run:old,existing:true};
  const pitched=new Set(s.campaigns.filter(c=>c.deliveries?.some(d=>['queued','sending','accepted','unknown'].includes(d.status))).flatMap(c=>[c.jobId,...(c.sprintJobIds || [])]).filter(Boolean));
  const catalog=await queryCatalog(store,plan,{view:'strong',limit:100}),byId=new Map([...catalog.jobs,...s.jobs].map(j=>[j.id,j])),seen=new Set();
  const jobs=[...byId.values()].filter(j=>!j.isDemo && !j.archived && !j.requiresSourceReview && !j.publishedAtIsUpdate && !pitched.has(j.id) && Date.parse(j.publishedAt || j.postedAt)>=Date.now()-14*86400000 && Date.parse(j.publishedAt || j.postedAt)<=Date.now()).map(job=>({job,match:rankOpportunity(job,plan)})).filter(v=>v.match.eligible && v.match.score>=75).sort((a,b)=>b.match.score-a.match.score).filter(({job})=>{const company=job.company.toLowerCase().trim();if(seen.has(company))return false;seen.add(company);return true;}).slice(0,5);
  if(!jobs.length)fail('No recent, unpitched roles match your preferences at 75% or higher. Run discovery or review source listings first.');
  const run={id:signature.slice(0,24),signature,profileHash:profileHash(s),createdAt:now(),status:'queued',targets:[]};
  store.state.settings.dailySprintRuns=[run,...runs.slice(0,13)];await store.save();
  for(const {job,match} of jobs){
    try{await retainCatalogJob(job.id,store);const result=await startJobPitch(job.id,{allowCredits:data.allowCredits===true,allowSearch:data.allowSearch===true,useAI:data.useAI===true,contactLimit:3},store,queue,config);run.targets.push({jobId:job.id,score:match.score,pitchId:result.pitch.id,company:job.company,title:job.title});}
    catch(error){run.targets.push({jobId:job.id,score:match.score,company:job.company,title:job.title,status:'failed',warning:error.status?error.message:'Preparation could not start.'});}
  }
  await store.refresh();store.state.settings.dailySprintRuns=[run,...(store.state.settings.dailySprintRuns || []).filter(r=>r.id!==run.id).slice(0,13)];
  const task=await queue.enqueue('workbench.sprint',{runId:run.id},{dedupeKey:`sprint:${run.id}`,maxAttempts:1});run.taskId=task.id;await store.save();return {run};
}
export async function finishDailySprint(task,store){
  const run=store.state.settings.dailySprintRuns?.find(r=>r.id===task.payload.runId);if(!run)return {status:'cancelled'};if(run.campaignId)return {campaignId:run.campaignId,cached:true};if(run.profileHash!==profileHash(store.state)){run.status='stale';await store.save();return {status:'cancelled'};}
  const pitches=run.targets.map(t=>store.state.jobPitches?.find(p=>p.id===t.pitchId));let waiting=false,changed=false;
  for(const pitch of pitches.filter(p=>p && ['queued','finding-contacts','tailoring-documents','drafting-pitch'].includes(p.status))){const task=await store.db.prepare('SELECT status FROM tasks WHERE id=?').get(pitch.taskId);if(!task || ['failed','cancelled','unknown'].includes(task.status)){pitch.status='failed';pitch.warning='Preparation stopped before completion. Review the worker task and prepare this role again.';changed=true;}else waiting=true;}
  if(waiting){if(changed)await store.save();return {status:'deferred',runAt:Date.now()+5000};}
  const contacts=[],messages={};for(const pitch of pitches){const c=store.state.campaigns.find(c=>c.id===pitch?.campaignId);if(!c)continue;for(const contactId of c.contactIds.slice(0,3)){const contact=store.state.contacts.find(c=>c.id===contactId);if(!contact || contact.suppressed || contacts.some(x=>x.email.toLowerCase()===contact.email?.toLowerCase()) || !c.personalizedMessages?.[contactId])continue;contacts.push(contact);messages[contactId]={...c.personalizedMessages[contactId],body:c.personalizedMessages[contactId].body.replace(/My r[eé]sum[eé] is attached\./g,'My résumé: {{resumeLink}}')};}}
  run.contactIds=contacts.map(c=>c.id);run.completedAt=now();if(!contacts.length){run.status='needs-attention';run.note='No supported contacts were found. Review source/domain requirements and contact lookup settings.';await store.save();return {status:'Needs attention'};}
  const accounts=await store.db.prepare('SELECT id FROM mail_accounts').all(),campaign={id:id(),studio:true,sprintId:run.id,sprintJobIds:run.targets.map(t=>t.jobId),sprintProfileHash:run.profileHash,createdAt:now(),name:`Daily outbound sprint · ${run.createdAt.slice(0,10)}`,subject:'Regarding {{role}} at {{company}}',body:'Hi {{firstName}}, I am interested in {{role}} at {{company}}. Could you point me to the hiring team?',personalizedMessages:messages,contactIds:contacts.map(c=>c.id),accountId:accounts.length===1?accounts[0].id:'',attachResume:false,trackResume:!!store.state.resume,sequence:{enabled:false},deliveries:[],deliveryMode:'paced',pacing:{min:2,max:5},status:'Draft'};store.state.campaigns.unshift(campaign);run.campaignId=campaign.id;run.status='ready';run.note='Review the exact messages and verify mailboxes before launch. Individual tailored documents remain in each role’s pitch.';await store.save();return {campaignId:campaign.id,contacts:contacts.length};
}
export function dailySprintStatus(runId,store){const run=store.state.settings.dailySprintRuns?.find(r=>r.id===runId);if(!run)fail('Sprint not found.',404);return {run:{...run,targets:run.targets.map(t=>({...t,status:t.status || store.state.jobPitches?.find(p=>p.id===t.pitchId)?.status || 'queued'}))},campaign:store.state.campaigns.find(c=>c.id===run.campaignId) || null};}
