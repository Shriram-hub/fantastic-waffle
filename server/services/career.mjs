import {z} from 'zod';
import {id,now,fail,text,hash} from '../domain.mjs';
import {structuredAI} from './ai.mjs';

export const careerData=store=>store.state.career || {weeklyGoal:10,tasks:[],stories:[],prep:[]};
function mutable(store){return store.state.career ||= {weeklyGoal:10,tasks:[],stories:[],prep:[]};}
export function careerStatus(store,clock=Date.now()) {
  const data=careerData(store),applications=store.state.applications.filter(a=>!a.isDemo),stageEvents=a=>a.history || [];
  const submitted=a=>stageEvents(a).some(e=>e.stage==='Applied') || ['Applied','Assessment','Interview','Interview scheduled','Offer','Rejected'].includes(a.stage);
  const submittedAt=a=>stageEvents(a).find(e=>e.stage==='Applied')?.at || (submitted(a) ? a.createdAt : null);
  const recent=applications.filter(a=>submitted(a) && Date.parse(submittedAt(a))>=clock-7*86400000).length;
  const tasks=data.tasks.filter(t=>!t.archived),open=tasks.filter(t=>!t.done),due=open.filter(t=>t.dueAt && Date.parse(t.dueAt)<=clock+7*86400000).sort((a,b)=>Date.parse(a.dueAt)-Date.parse(b.dueAt));
  return {...data,tasks,stats:{tracked:applications.length,submitted:applications.filter(submitted).length,interviews:applications.filter(a=>['Interview','Interview scheduled'].includes(a.stage)||stageEvents(a).some(e=>['Interview','Interview scheduled'].includes(e.stage))).length,offers:applications.filter(a=>a.stage==='Offer'||stageEvents(a).some(e=>e.stage==='Offer')).length,rejected:applications.filter(a=>a.stage==='Rejected').length,appliedLast7Days:recent,openTasks:open.length,overdue:open.filter(t=>t.dueAt && Date.parse(t.dueAt)<clock).length,stageCounts:Object.fromEntries(['Saved','Ready','Applied','Outreach Sent','Assessment','Interview','Interview scheduled','Offer','Rejected','Withdrawn','Archived'].map(stage=>[stage,applications.filter(a=>a.stage===stage).length]))},due,aiConfigured:false};
}
const taskSchema=z.object({title:z.string().trim().min(1).max(200),kind:z.enum(['Follow-up','Interview','Assessment','Learning','Other']).default('Other'),dueAt:z.string().max(50).nullable().default(null),jobId:z.string().max(100).nullable().default(null),notes:z.string().max(6000).default(''),done:z.boolean().default(false),archived:z.boolean().default(false)}).strict();
export async function saveCareerTask(data,store,taskId) {
  const career=mutable(store),old=taskId ? career.tasks.find(t=>t.id===taskId) : null;
  if(taskId && !old)fail('Task not found.',404);
  const {id:ignored,createdAt,updatedAt,...base}=old || {};
  const {expectedUpdatedAt,...patch}=data;
  if(old && expectedUpdatedAt!==undefined && expectedUpdatedAt!==old.updatedAt)fail('This task changed in another view. Reload before saving.',409);
  const parsed=taskSchema.safeParse({...base,...patch});if(!parsed.success)fail('Enter a task title, valid type and supported task fields.');
  const value=parsed.data;
  if(value.dueAt && (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value.dueAt) || !Number.isFinite(Date.parse(value.dueAt))))fail('Choose a valid due date with a time zone.');
  if(value.jobId && !store.state.jobs.some(j=>j.id===value.jobId))fail('Choose an existing job.');
  if(!old && career.tasks.length>=500)fail('The planner supports up to 500 tasks.');
  const task={...value,id:taskId || id(),createdAt:createdAt || now(),updatedAt:now()};
  if(old)Object.assign(old,task);else career.tasks.unshift(task);
  career.updatedAt=now();await store.save();return task;
}
const storySchema=z.object({title:z.string().trim().min(1).max(200),situation:z.string().max(4000).default(''),task:z.string().max(4000).default(''),action:z.string().max(4000).default(''),result:z.string().max(4000).default(''),archived:z.boolean().default(false)}).strict();
export async function saveCareerStory(data,store,storyId) {
  const career=mutable(store),old=storyId ? career.stories.find(s=>s.id===storyId) : null;if(storyId && !old)fail('Story not found.',404);
  const {id:ignored,createdAt,updatedAt,...base}=old || {},{expectedUpdatedAt,...patch}=data;
  if(old && expectedUpdatedAt!==undefined && expectedUpdatedAt!==old.updatedAt)fail('This story changed in another view. Reload before saving.',409);
  const parsed=storySchema.safeParse({...base,...patch});
  if(!parsed.success)fail('Add a story title and use the Situation, Task, Action and Result fields.');
  if(!old && career.stories.length>=50)fail('Your story bank supports up to 50 stories.');
  const story={...parsed.data,id:storyId || id(),createdAt:createdAt || now(),updatedAt:now()};if(old)Object.assign(old,story);else career.stories.unshift(story);
  career.updatedAt=now();await store.save();return story;
}
export const prepFingerprint=(store,job,useAI)=>hash(['interview-prep-v2',job.id,job.title,job.description,store.state.resume?.text || '',store.state.profile.master || store.state.profile.skills,(store.state.career?.stories || []).filter(s=>!s.archived),useAI]);
export function templatePrep(store,job) {
  const snippets=String(job.description || '').split(/\n|(?<=[.!?])\s+/).map(s=>s.trim()).filter(s=>s.length>25 && s.length<=600).slice(0,5);
  const skills=(job.tags || []).filter(s=>typeof s==='string' && s.length<60).slice(0,3);
  const finance=/financ|account|investment|valuation|fp&a/i.test(`${job.title} ${job.description}`) ? [
    {question:'Walk through how the financial statements connect. How can profit rise while operating cash flow falls?',jobQuote:snippets.find(s=>/financial statements|cash flow/i.test(s)) || ''},
    {question:'Practice case: which assumptions would you test in a valuation or forecast, and how would you explain sensitivity to them?',jobQuote:snippets.find(s=>/valuation|forecast|model/i.test(s)) || ''},
    {question:'How would you investigate a reconciliation variance and document the evidence for review?',jobQuote:snippets.find(s=>/reconcil|account|variance/i.test(s)) || ''},
  ] : [];
  const questions=[{question:`Walk me through the experience that prepares you for this ${job.title} role.`,jobQuote:snippets[0] || ''},{question:'Describe a difficult problem you owned. What did you do and how did you measure the result?',jobQuote:''},...finance,...skills.map(skill=>({question:`How have you used ${skill}, and what would you review before this interview?`,jobQuote:snippets.find(s=>s.toLowerCase().includes(skill.toLowerCase())) || ''})),{question:'Tell me about a time you received feedback and changed your approach.',jobQuote:''}].slice(0,8);
  return {questions,companyQuestions:['What would success look like in the first 90 days?','Which problems would this role tackle first?','How does the team give feedback and support development?'],requirements:snippets};
}
export async function buildInterviewPrep(task,store,queue,config={},fetcher=fetch) {
  const job=store.state.jobs.find(j=>j.id===task.payload.jobId);if(!job || prepFingerprint(store,job,task.payload.useAI)!==task.payload.fingerprint)return {status:'cancelled'};
  const existing=careerData(store).prep.find(p=>p.fingerprint===task.payload.fingerprint);if(existing)return {prepId:existing.id,cached:true};
  const result=templatePrep(store,job);let method='Role-based practice guide';
  if(task.payload.useAI) {
    const schema=z.object({questions:z.array(z.object({question:z.string().max(500),jobQuote:z.string().max(600)}).strict()).min(3).max(8),companyQuestions:z.array(z.string().max(400)).max(5)}).strict();
    const source=text(job.description,14000);
    const output=await structuredAI(schema,'Write practice interview questions for this specific role, not assessment answers. Ask about professional skills and experience. Each job-specific question must cite a short exact quote from the job description; generic behavioral questions may use an empty jobQuote. Do not invent candidate achievements, outcomes or company facts. Do not ask demographic or personal eligibility questions. Return questions only, never claim the candidate has an answer.',{job:{title:job.title,company:job.company,description:source},resume:text(store.state.resume?.text,20000)},config,fetcher,store);
    const checked=output.questions.filter(q=>q.question.trim() && (!q.jobQuote || source.includes(q.jobQuote)) && !/religion|pregnan|date of birth|marital|ethnic|disabil|veteran|citizenship/i.test(q.question));
    if(checked.length>=3){result.questions=checked;result.companyQuestions=output.companyQuestions;method='Gemini / configured AI practice guide';}
  }
  await store.refresh();const latest=store.state.jobs.find(j=>j.id===job.id);if(!latest || prepFingerprint(store,latest,task.payload.useAI)!==task.payload.fingerprint)return {status:'cancelled'};
  const career=mutable(store),old=career.prep.find(p=>p.fingerprint===task.payload.fingerprint);if(old)return {prepId:old.id,cached:true};
  const stories=career.stories.filter(s=>!s.archived),tokens=v=>new Set(String(v).toLowerCase().match(/[a-z]{4,}/g) || []);
  const prep={id:id(),jobId:job.id,company:job.company,role:job.title,jobUrl:job.url,fingerprint:task.payload.fingerprint,method,trigger:task.payload.trigger || 'manual',createdAt:now(),...result,questions:result.questions.map(q=>{
    const words=tokens(`${q.question} ${q.jobQuote} ${job.title}`),score=s=>[...tokens(`${s.title} ${s.situation} ${s.task} ${s.action} ${s.result}`)].filter(t=>words.has(t)).length;
    return {...q,id:id(),answerNotes:'',storyIds:stories.filter(s=>score(s)>0).sort((a,b)=>score(b)-score(a)).slice(0,2).map(s=>s.id)};
  })};
  career.prep=[prep,...career.prep].slice(0,50);career.updatedAt=now();await store.save();return {prepId:prep.id};
}
export function careerOverview(state){const value=careerStatus({state});return {weeklyGoal:value.weeklyGoal,updatedAt:state.career?.updatedAt || null,stats:value.stats,due:value.due.slice(0,5).map(({notes,...task})=>task)};}
const icsEscape=v=>String(v || '').replaceAll('\\','\\\\').replaceAll('\r','').replaceAll('\n','\\n').replaceAll(';','\\;').replaceAll(',','\\,');
function fold(line){let output='',width=0;for(const char of line){const size=Buffer.byteLength(char);if(width+size>74){output+='\r\n ';width=1;}output+=char;width+=size;}return output;}
export function plannerCalendar(store) {
  const stamp=value=>new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Veloce//Career Planner//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH'];
  for(const task of careerData(store).tasks.filter(t=>!t.done && !t.archived && t.dueAt && Number.isFinite(Date.parse(t.dueAt)))) {
    const job=store.state.jobs.find(j=>j.id===task.jobId);
    lines.push('BEGIN:VEVENT',`UID:${task.id}@orbit-career`, `DTSTAMP:${stamp(Date.now())}`,`DTSTART:${stamp(task.dueAt)}`,`DTEND:${stamp(Date.parse(task.dueAt)+30*60000)}`,`SUMMARY:${icsEscape(task.title)}`,`DESCRIPTION:${icsEscape([task.kind,job && `${job.company} / ${job.title}`,task.notes,job?.url].filter(Boolean).join('\n'))}`,'BEGIN:VALARM','TRIGGER:-PT15M','ACTION:DISPLAY',`DESCRIPTION:${icsEscape(task.title)}`,'END:VALARM','END:VEVENT');
  }
  return [...lines,'END:VCALENDAR'].map(fold).join('\r\n')+'\r\n';
}
