import {z} from 'zod';
import {id,now,fail,text,hash} from '../domain.mjs';
import {structuredAI} from './ai.mjs';
import {candidateProfile} from './candidate-profile.mjs';
import {INTERVIEW_TRACKS,QUESTION_BANK,inferTrack,interviewQuestions} from './interview-bank.mjs';
import {withDeadline,boundedFetcher} from '../providers/deadline.mjs';
export {INTERVIEW_TRACKS,QUESTION_BANK,inferTrack,interviewQuestions};

export function candidateEvidence(state) {
  const master=candidateProfile(state.profile),stories=(state.career?.stories || []).filter(s=>!s.archived && !s.practiceOnly);
  return [...master.workExperience.flatMap(w=>[w.description,...w.bullets]),...master.projects.map(p=>p.description),...stories.flatMap(s=>[s.situation,s.task,s.action,s.result]),master.summary.professionalSummary,...String(state.resume?.text || '').split('\n')].map(s=>String(s || '').trim()).filter(Boolean).slice(0,100);
}
const includesConcept=(value,keyword)=>new RegExp(`(?:^|[^a-z0-9])${keyword.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?:$|[^a-z0-9])`,'i').test(value);
export function gradeInterviewAnswer({answer,question,elapsedSeconds=120},state) {
  const words=answer.trim().split(/\s+/).filter(Boolean),count=words.length;
  const coverage=question.keywords.filter(k=>includesConcept(answer,k)),missingKeywords=question.keywords.filter(k=>!coverage.includes(k));
  const markers=[/\b(situation|context|challenge|problem|first|start)\b/i,/\b(task|goal|responsib|objective|then|next)\w*/i,/\b(I |we |action|built|tested|analy[sz]|implement|would)\w*/i,/\b(result|outcome|therefore|finally|learn|conclusion|recommend)\w*/i];
  const structure=Math.min(25,markers.filter(r=>r.test(answer)).length*5+(count>=40?5:0));
  const depth=Math.min(25,Math.round(25*coverage.length/Math.max(1,question.keywords.length)));
  const metrics=Math.min(25,(/\d+(?:\.\d+)?\s*(?:%|percent|hours?|days?|weeks?|users?|customers?|million|crore|lakh|ms|seconds?|x\b)/i.test(answer)?20:/\d/.test(answer)?12:0)+(/baseline|compar|from .+ to |assumption|sensitivity|measur/i.test(answer)?5:0));
  const conciseness=count<10?0:count<35?8:count<=260?25:count<=350?15:5;
  const scores={structure,technicalDepth:depth,quantifiedMetrics:metrics,conciseness},evidence=candidateEvidence(state);
  const evidenceKeywords=[...new Set([...(state.profile.skills || []),...question.keywords])].filter(k=>evidence.some(s=>includesConcept(s,k)) && !includesConcept(answer,k)).slice(0,8);
  const relevant=evidence.map(excerpt=>({excerpt,hits:question.keywords.filter(k=>includesConcept(excerpt,k)).length})).filter(e=>e.hits>0 && !answer.includes(e.excerpt)).sort((a,b)=>b.hits-a.hits).slice(0,2).map(e=>e.excerpt);
  const worked=[structure>=15?'Your answer has a clear progression.':'',coverage.length?`Relevant concepts: ${coverage.join(', ')}.`:'',metrics>=12?'You included quantitative detail; confirm you can substantiate it.':'',conciseness===25?'The answer fits a focused two-minute response.':''].filter(Boolean);
  const missing=[missingKeywords.length?`Develop these concepts: ${missingKeywords.join(', ')}.`:'',structure<15?'State a clear starting point, your approach and a conclusion.':'',metrics<12?'Add a genuine outcome or, for a case, explicit assumptions and a calculation. Do not invent a number.':'',count>260?'Shorten the answer to its decision, evidence and result.':'',count<35?'Explain the reasoning with a concrete example.':''].filter(Boolean);
  // Candidate claims are copied, never fabricated. Technical reference answers
  // describe an approach and make no claim that the candidate did that work.
  const modelAnswer=question.kind==='behavioral'
    ? [answer.trim(),...relevant.map(s=>`A relevant example from my saved experience: ${s}`)].join('\n\n')
    : [question.reference,...relevant.map(s=>`A relevant example from my saved experience: ${s}`)].join('\n\n');
  return {score:Object.values(scores).reduce((a,b)=>a+b,0),scores,worked,missing,missingKeywords,evidenceKeywords,modelAnswer,evidence:relevant,wordCount:count,elapsedSeconds,method:'Local practice rubric',note:'Practice feedback is a heuristic, not an employer assessment. Reference answers are study aids; keep only claims you can support.'};
}
export async function evaluateInterviewAnswer(data,store,config={},fetcher=fetch) {
  if(typeof data.answer!=='string' || data.answer.trim().length<10 || data.answer.length>6000)fail('Write an answer between 10 and 6,000 characters.');
  if(data.elapsedSeconds!==undefined && (!Number.isFinite(data.elapsedSeconds) || data.elapsedSeconds<0 || data.elapsedSeconds>7200))fail('Use a valid response duration.');
  const job=data.jobId?store.state.jobs.find(j=>j.id===data.jobId):null;
  if(data.jobId && !job)fail('Choose an existing job.',404);
  const track=data.track || inferTrack(job?.title),question=QUESTION_BANK[track]?.find(q=>q.id===data.questionId);
  if(!question)fail('Choose a question from a supported interview track.');
  const result=gradeInterviewAnswer({answer:data.answer,question,elapsedSeconds:data.elapsedSeconds},store.state);
  if(data.useAI===true) {
    if(data.confirmed!==true)fail('Approve sending this practice answer and saved professional evidence to Gemini.');
    if(config.LLM_API_KEY && config.LLM_MODEL) {
      const excerpts=candidateEvidence(store.state),schema=z.object({feedback:z.array(z.object({answerQuote:z.string().max(700),comment:z.string().max(600)}).strict()).max(4),evidence:z.array(z.string().max(1800)).max(2)}).strict();
      try {
        const output=await withDeadline(signal=>structuredAI(schema,'Coach a practice interview answer. Give specific feedback supported by an exact answerQuote. Select relevant candidate evidence copied EXACTLY from the supplied evidence list. Do not invent, rewrite or embellish personal achievements or metrics. The scoring rubric is deterministic and must not be replaced.',{question:question.prompt,answer:data.answer,rubric:result.scores,evidence:excerpts,role:job?.title},config,boundedFetcher(fetcher,signal),store),12000);
        result.coaching=output.feedback.filter(f=>f.answerQuote.trim() && data.answer.includes(f.answerQuote));
        const safe=output.evidence.filter(e=>excerpts.includes(e));
        result.evidence=safe.length?safe:result.evidence;
        if(safe.length)result.modelAnswer=[question.kind==='behavioral'?data.answer.trim():question.reference,...safe.map(e=>`A relevant example from my saved experience: ${e}`)].join('\n\n');
        result.method='Local rubric with source-checked Gemini coaching';
      }catch{result.warning='Gemini was unavailable. Your complete local-rubric feedback is ready.';}
    }else result.warning='No model is configured. Your complete local-rubric feedback is ready.';
  }
  return {...result,id:id(),track,questionId:question.id,question:question.prompt,createdAt:now()};
}

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
const storySchema=z.object({title:z.string().trim().min(1).max(200),situation:z.string().max(4000).default(''),task:z.string().max(4000).default(''),action:z.string().max(4000).default(''),result:z.string().max(4000).default(''),practiceOnly:z.boolean().default(false),archived:z.boolean().default(false)}).strict();
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
