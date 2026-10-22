import {contactTargeting,prioritizeContact,pitchAngle,PERSONA_FILTERS,PITCH_ANGLES} from './contact-personas.mjs';
import {hydrateJobDetail} from './job-details.mjs';
import {id,hash,now,fail,emailValid} from '../domain.mjs';
import {companyDomain,resolveCompany} from '../providers/contacts/company.mjs';
import {findCompanyContacts} from './contact-discovery.mjs';
import {ensureJobDocuments,documentSummary,documentFingerprint} from './job-documents.mjs';
import {draftAutopilotPitch} from './ai.mjs';
import {activity} from './autopilot-policy.mjs';

const sourceHash=(s,j)=>hash({profile:s.profile,resume:s.resume?.contentHash || s.resume?.base64,text:s.resume?.text,job:{id:j.id,title:j.title,company:j.company,description:j.descriptionHash || j.description,url:j.url,archived:j.archived}});
// Bound UTF-16 length as well as Unicode code points for clipboard consumers.
export function linkedInDrafts(job,contact,profile={},requestedAngle='auto') {
  const bound=(value,max)=>{let result=value.slice(0,max);if(/[\uD800-\uDBFF]$/.test(result))result=result.slice(0,-1);return result;};
  const compact=(value,max)=>bound(String(value || '').replace(/\s+/g,' ').trim(),max);
  const first=compact(contact.firstName || contact.name?.split(' ')[0] || 'there',24);
  const role=compact(job.title,72),company=compact(job.company,44);

  const angle=pitchAngle(contact,requestedAngle);
  const note=angle==='value' ? `Hi ${first}, I’m exploring ${role} at ${company}. May I share relevant work from my résumé with your team?` : angle==='referral' ? `Hi ${first}, I’m exploring ${role} at ${company}. Could I ask for 10 minutes of advice on your team?` : `Hi ${first}, I’m interested in ${role} at ${company}. May I share a concise role-fit summary?`;
  return {angle,connectionNote:bound(note,199),followUpDM:bound(angle==='referral' ? `Thanks for connecting, ${first}. I’m considering ${role} at ${company}. Would you have 10 minutes to share advice about the team, or suggest the right person for a referral if you think my background fits?` : angle==='value' ? `Thanks for connecting, ${first}. I’m exploring ${role} at ${company}. May I share a relevant example from my résumé and discuss how it relates to your team’s priorities?` : `Thanks for connecting, ${first}. I’m interested in ${role} at ${company}. May I send a concise summary of my relevant experience and tailored résumé for your review?`,449)};
}
export function pitchSummary(run,store) {
  const document=(store.state.jobDocuments || []).find(d=>d.id===run.documentSetId);
  return {...run,contacts:(run.contactIds || []).map(id=>store.state.contacts.find(c=>c.id===id)).filter(Boolean).map(contact=>({...contact,linkedIn:linkedInDrafts(store.state.jobs.find(j=>j.id===run.jobId) || {title:'open',company:contact.company},contact,store.state.profile,run.options?.pitchAngle || 'auto')})),documents:document ? documentSummary(document) : null};
}
const pitchRequests=new WeakMap();
export async function startJobPitch(jobId,data,store,queue,config={}) {
  const previous=pitchRequests.get(store) || Promise.resolve();
  const pending=previous.catch(()=>{}).then(()=>startReservedPitch(jobId,data,store,queue,config));
  pitchRequests.set(store,pending);try{return await pending;}finally{if(pitchRequests.get(store)===pending)pitchRequests.delete(store);}
}
async function startReservedPitch(jobId,data,store,queue,config) {
  await store.db.exec('BEGIN IMMEDIATE');
  try {
    await store.refresh();
    const result=await reserveJobPitch(jobId,data,store,queue,config);
    await store.db.exec('COMMIT');return result;
  } catch(error){await store.db.exec('ROLLBACK');throw error;}
}
async function reserveJobPitch(jobId,data,store,queue,config) {
  const s=store.state,j=s.jobs.find(j=>j.id===jobId);
  if(!j || j.isDemo || j.archived || s.isDemo)fail('Choose an active, real job.',404);
  if(j.requiresSourceReview && data.sourceReviewed!==true)fail('Review this indexed listing on the original board before preparing a pitch.');
  if(!s.profile.name || !emailValid(s.profile.email || '') || !s.resume?.text)fail('Save your name, email and readable résumé first.');
  if(data.allowCredits===true && !config.HUNTER_API_KEY)fail('Hunter is not configured. Use free discovery.',503);
  if(data.useAI===true && (!config.LLM_API_KEY || !config.LLM_MODEL))fail('Configure Gemini or use factual templates.',503);
  const targetPersona=data.targetPersona || 'all',angle=data.pitchAngle || 'auto';
  if(!PERSONA_FILTERS.includes(targetPersona) || !PITCH_ANGLES.includes(angle))fail('Choose a valid persona and pitch angle.');
  const domain=data.companyDomain ? companyDomain(data.companyDomain) : '';
  if(data.companyDomain && (!domain || data.confirmedDomain!==true))fail('Confirm a corporate domain, without a URL or job-board host.');
  const scope=sourceHash(s,j),signature=hash({jobId,scope,domain,targetPersona,pitchAngle:angle,allowCredits:data.allowCredits===true,allowSearch:data.allowSearch===true,useAI:data.useAI===true});
  const previous=(s.jobPitches || []).find(r=>r.signature===signature && !['failed','needs-domain'].includes(r.status));
  if(previous)return {pitch:pitchSummary(previous,store),existing:true};
  const run={id:id(),jobId,signature,sourceHash:scope,status:'queued',createdAt:now(),contactIds:[],options:{domain,targetPersona,pitchAngle:angle,allowCredits:data.allowCredits===true,allowSearch:data.allowSearch===true,useAI:data.useAI===true}};
  if(!s.applications.some(a=>a.jobId===jobId))s.applications.push({id:id(),jobId,stage:'Saved',notes:'Company pitch prepared from job feed',createdAt:now(),updatedAt:now(),isDemo:false,history:[{stage:'Saved',at:now(),source:'Company pitch preparation'}]});
  s.jobPitches=[run,...(s.jobPitches || []).slice(0,49)];
  const task=await queue.enqueue('job.auto-pitch',{pitchId:run.id},{dedupeKey:`job-pitch:${run.id}`,maxAttempts:1});run.taskId=task.id;await store.save(true);
  return {pitch:pitchSummary(run,store)};
}
export async function buildJobPitch(task,store,queue,config,fetcher=fetch,dependencies={}) {
  let run=(store.state.jobPitches || []).find(r=>r.id===task.payload.pitchId),job=store.state.jobs.find(j=>j.id===run?.jobId);
  if(!run || !job)return {status:'cancelled'};
  const fresh=async()=>{await store.refresh();run=(store.state.jobPitches || []).find(r=>r.id===task.payload.pitchId);job=store.state.jobs.find(j=>j.id===run?.jobId);if(!run || !job || run.sourceHash!==sourceHash(store.state,job))fail('Your profile or this role changed. Prepare the pitch again.',409);job=await hydrateJobDetail(job,store);};
  const stage=async(status)=>{run.status=status;run.updatedAt=now();await store.save();await activity(store,'pitch',`${job.company}: ${status.replaceAll('-',' ')}.`,1);};
  try {
    await fresh();await stage('finding-contacts');
    const company=run.options.domain ? {name:job.company,domain:run.options.domain,source:'User-confirmed corporate domain'} : await resolveCompany(job,fetcher,store);
    if(!company || company.requiresDomainReview){run.company=company;run.status='needs-domain';run.warning='Confirm the company’s official domain to continue. DNS alone cannot identify the employer.';await store.save();return {status:'Needs domain review'};}
    const found=await findCompanyContacts(job,company,{store,config,fetcher,lookupMx:dependencies.lookupMx,pages:dependencies.contactPages,allowCredits:run.options.allowCredits,allowWarmSearch:run.options.allowSearch,limit:5,dailyLimit:Math.min(100,Number(config.CONTACT_API_DAILY_LIMIT) || 20),targetPersona:run.options.targetPersona || 'all'});
    await fresh();
    Object.assign(store.state.jobs.find(j=>j.id===job.id),{companyDomain:company.domain,companyDomainSource:'confirmed-pitch-resolution'});
    await store.db.prepare('INSERT INTO companies(domain,name,body) VALUES(?,?,?) ON CONFLICT(domain) DO UPDATE SET body=excluded.body').run(company.domain,job.company,JSON.stringify(company));
    const contacts=[];
    for(const incoming of found.contacts){let contact=store.state.contacts.find(c=>c.email && c.email.toLowerCase()===incoming.email?.toLowerCase());if(contact?.suppressed || contact?.isDemo)continue;if(!contact){contact={...incoming,id:id(),company:job.company,companyDomain:company.domain,jobId:job.id,jobTitle:job.title,jobUrl:job.url};store.state.contacts.push(contact);}else {const oldId=contact.id,status=contact.emailStatus,verification=contact.verification;Object.assign(contact,incoming,{id:oldId,jobId:contact.jobId || job.id});if(status==='verified'){contact.emailStatus=status;contact.verification=verification;}}contacts.push(contact);}
    run.company=company;run.contactIds=contacts.map(c=>c.id);run.warnings=found.warnings;await store.save();await stage('tailoring-documents');
    const document=await ensureJobDocuments(job,store,queue,config,fetcher,run.options.useAI);if(!document)fail('The résumé changed during document preparation. Retry.',409);
    await fresh();run.documentSetId=document.id;await store.save();await stage('drafting-pitch');
    const personalizedMessages={};
    for(const contact of contacts)personalizedMessages[contact.id]=await draftAutopilotPitch(store.state,job,contact,'',{useAI:run.options.useAI,pitchAngle:run.options.pitchAngle},config,fetcher,store);
    await fresh();
    if(document.fingerprint!==documentFingerprint(store.state,job,document.useAI))fail('Generate a new document snapshot for the updated profile.',409);
    const accounts=await store.db.prepare('SELECT id FROM mail_accounts').all(),campaignId=id();
    const campaign={id:campaignId,name:`${job.company} · ${job.title}`,createdAt:now(),status:'Draft',jobId:job.id,documentSetId:document.id,attachResume:true,attachCoverLetter:false,trackResume:false,accountId:accounts.length===1 ? accounts[0].id : null,deliveries:[],contactIds:contacts.map(c=>c.id),subject:`${job.title} at ${job.company}`,body:'Hi {{first_name}},\n\n{{warm_hook}}\n\nI’m interested in the {{job_title}} opening at {{company}}. My tailored résumé is attached. Could you point me to the hiring team?',personalizedMessages,sequence:{enabled:accounts.length===1,steps:[{afterBusinessDays:4,body:'Hi {{first_name}}, I wanted to follow up on the role at {{company}}. Would you be the right person to speak with?'},{afterBusinessDays:8,body:'Hi {{first_name}}, one last follow-up about this role at {{company}}. Thank you for your time; I’m happy to provide anything else you need.'}]}};
    if(contacts.length){store.state.campaigns.unshift(campaign);run.campaignId=campaignId;}
    await stage(contacts.some(c=>c.emailStatus==='verified') ? 'ready-for-review' : 'needs-verification');
    return {status:'Prepared for review',contacts:contacts.length,verified:contacts.filter(c=>c.emailStatus==='verified').length,campaignId:run.campaignId || null};
  }catch(error){await store.refresh();run=(store.state.jobPitches || []).find(r=>r.id===task.payload.pitchId);if(run){run.status='failed';run.warning=error.status ? error.message : 'Pitch preparation failed. Inspect Automation or try free discovery.';await store.save();}throw error;}
}
