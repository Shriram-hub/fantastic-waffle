import {id,now,hash,text,fail,normalizeContact,previewCampaign,campaignFingerprint,parseCSV} from '../domain.mjs';
import {MAIL_PRESETS,MERGE_TAGS} from '../../shared/mail-merge.mjs';
import {normalizeSequence} from './sequences.mjs';
import {queueCampaign,businessSlot} from './outreach.mjs';
import {ensureCampaignLinks} from './engagement.mjs';
import {warmHook} from './warm-connections.mjs';
import {documentFingerprint} from './job-documents.mjs';
import {scoreDeliverability} from './deliverability.mjs';
export {MAIL_PRESETS,MERGE_TAGS};
export function contactedEmails(state) {
  const contacts=new Map(state.contacts.map(c=>[c.id,c]));
  return new Set(state.campaigns.flatMap(c=>c.deliveries.filter(d=>['queued','sending','accepted','unknown'].includes(d.status)).map(d=>contacts.get(d.contactId)?.email?.toLowerCase())).filter(Boolean));
}
export async function pasteContacts(value,store) {
  if(typeof value!=='string' || !value.trim() || value.length>50000)fail('Paste up to 100 rows: Name, Email, Company, Role.');
  const csv=/^\s*name\s*,\s*email\s*,/i.test(value)?value:`name,email,company,title\n${value}`;
  const rows=parseCSV(csv);if(rows.length>100)fail('Paste at most 100 contacts per batch.');
  const imported=[],errors=[],seen=new Set(store.state.contacts.map(c=>c.email?.toLowerCase()).filter(Boolean));
  for(const [index,row] of rows.entries())try{const contact=normalizeContact({...row,title:row.title || row.role,email_status:'unverified'},'Quick paste');if(!contact.email)fail('Missing email.');if(seen.has(contact.email.toLowerCase())){errors.push(`Row ${index+1}: already in contacts.`);continue;}seen.add(contact.email.toLowerCase());imported.push(contact);}catch(e){errors.push(`Row ${index+1}: ${e.status?e.message:'Invalid contact.'}`);}
  store.state.contacts.push(...imported);await store.save();return {imported:imported.length,contactIds:imported.map(c=>c.id),errors,note:'Pasted contacts need mailbox verification before sending. MX checks establish domain mail routing only.'};
}
export async function prepareQuickBatch(data,store,config={}) {
  if(store.state.isDemo)fail('Start a personal workspace before preparing a real email batch.');
  if(!Array.isArray(data.contactIds) || !data.contactIds.length || data.contactIds.length>100 || data.contactIds.some(x=>typeof x!=='string'))fail('Choose between 1 and 100 contacts.');
  if(typeof data.subject!=='string' || !data.subject.trim() || data.subject.length>500 || /[\r\n]/.test(data.subject) || typeof data.body!=='string' || !data.body.trim() || data.body.length>15000)fail('Add a one-line subject and a message up to 15,000 characters.');
  const contacts=[...new Set(data.contactIds)].map(key=>store.state.contacts.find(c=>c.id===key));if(contacts.some(c=>!c))fail('One of the selected contacts no longer exists.',409);
  const document=data.documentSetId?(store.state.jobDocuments || []).find(d=>d.id===data.documentSetId):null,job=data.jobId?store.state.jobs.find(j=>j.id===data.jobId):null;
  if(data.jobId && !job)fail('Choose a current job for tailored documents.');
  if(data.documentSetId && (!document || document.jobId!==job?.id || document.fingerprint!==documentFingerprint(store.state,job,document.useAI)))fail('Generate current tailored documents for this role.',409);
  if(document && contacts.some(c=>c.company.toLowerCase()!==job.company.toLowerCase() && (!job.companyDomain || c.companyDomain!==job.companyDomain)))fail('Tailored documents can only be sent to contacts at their target company.');
  if(data.attachResume && !document && (!store.state.resume || !/\.pdf$/i.test(store.state.resume.name)))fail('Upload a master PDF resume or select a tailored PDF first.');
  if(data.trackResume && !store.state.resume)fail('Upload a resume before including a tracked link.');
  const accountId=text(data.accountId,100);if(!accountId || !await store.db.prepare('SELECT id FROM mail_accounts WHERE id=?').get(accountId))fail('Connect and select your Gmail or Outlook mailbox first.');
  const sequence=normalizeSequence(data.sequence,accountId),deliveryMode=data.deliveryMode==='test'?'test':'paced';
  if(deliveryMode==='test' && contacts.length>5)fail('Instant test mode supports at most five reviewed recipients.');
  const old=data.campaignId?store.state.campaigns.find(c=>c.id===data.campaignId):null;
  if(old?.sprintProfileHash && old.sprintProfileHash!==hash([store.state.profile,store.state.resume?.contentHash || store.state.resume?.text]))fail('Your profile changed. Start a fresh sprint before reviewing these drafts.',409);
  if(old?.deliveries.length)fail('This batch already has delivery history. Start a new draft.',409);
  const blocked=contacts.filter(c=>c.isDemo || !c.email || c.suppressed || c.requiresDomainReview || c.emailStatus!=='verified');
  if(blocked.length)fail(`${blocked.length} selected contact(s) need verified mailboxes or domain review before launch. MX-only addresses are not mailbox-verified.`,409);
  const previously=contactedEmails(store.state);if(contacts.some(c=>previously.has(c.email.toLowerCase())))fail('A selected address already has pending or accepted outreach. Refresh the uncontacted filter.',409);
  const campaign=old || {id:id(),createdAt:now(),deliveries:[]};
  const next={...campaign,personalizedMessages:data.keepPersonalized===false?{}:campaign.personalizedMessages,name:text(data.name,150) || `Mail batch ${now().slice(0,10)}`,subject:data.subject.trim(),body:data.body,contactIds:contacts.map(c=>c.id),attachResume:data.attachResume===true,trackResume:data.trackResume===true,attachCoverLetter:false,documentSetId:document?.id || null,jobId:job?.id || null,accountId,sequence,deliveryMode,pacing:{min:2,max:5},studio:true,status:'Draft'};
  for(const c of contacts)c.warmOpener=warmHook(c,store.state);
  // Validate merge tags and attachments before generating any tracked links.
  previewCampaign(next,store.state);
  if(next.trackResume && old && (old.documentSetId!==next.documentSetId || old.jobId!==next.jobId))next.resumeLinks={};
  await ensureCampaignLinks(next,store,config);
  const preview=previewCampaign(next,store.state);preview.messages=preview.messages.map(message=>({...message,writingChecks:scoreDeliverability(message)}));
  if(/\{\{[^{}]+\}\}/.test(preview.messages.map(m=>`${m.subject}\n${m.body}`).join('\n')))fail('Resolve all template variables before sending.');
  if(!next.trackResume && /\{\{\s*(?:resumeLink|resume_url)\s*\}\}/.test(next.body) && !store.state.profile.resumeUrl)fail('Enable the tracked resume link or save a public resume URL in your profile.');
  if(old)Object.assign(old,next);else store.state.campaigns.unshift(next);
  // A bounded preview vault avoids accumulating expired tokens on every review.
  store.state.previews=Object.fromEntries(Object.entries(store.state.previews || {}).filter(([,p])=>p.expires>Date.now()).slice(-30));
  const previewId=id();store.state.previews[previewId]={campaignId:next.id,fingerprint:campaignFingerprint(next,store.state),expires:Date.now()+600000};next.status='Reviewed';
  await store.save();return {...preview,previewId,campaignId:next.id,deliveryMode,sequence:next.sequence,liveSendReady:config.ENABLE_LIVE_SEND==='true',note:deliveryMode==='test'?'Explicit test batch: up to five messages. Daily account limits still apply.':'Paced at 2–5 minute intervals during your configured business hours. Daily account limits still apply.'};
}
const launches=new WeakMap();
export async function launchQuickBatch(data,store,queue,config={}) {
  // Keep concurrent button requests from starting nested SQLite transactions,
  // and refresh before checking the durable outbox. SQL reservations provide
  // the additional protection across separate processes.
  const previous=launches.get(store) || Promise.resolve();let release;
  const gate=new Promise(resolve=>{release=resolve;});launches.set(store,gate);
  await previous;
  try {await store.refresh();return await launchReviewedBatch(data,store,queue,config);}
  finally {release();if(launches.get(store)===gate)launches.delete(store);}
}
async function launchReviewedBatch(data,store,queue,config={}) {
  const campaign=store.state.campaigns.find(c=>c.id===data.campaignId && c.studio);if(!campaign)fail('Review this mail batch before launching.',404);
  if(data.approved!==true || !Number.isInteger(data.confirmCount))fail('Approve the exact reviewed recipient count.');
  const pending=await store.db.prepare("SELECT id FROM tasks WHERE kind='campaign.send' AND json_extract(payload,'$.campaignId')=? AND status IN ('queued','running','completed','unknown') LIMIT 1").get(campaign.id);
  if(pending)return {existing:true,campaignId:campaign.id,progress:await batchProgress(campaign.id,store)};
  if(contactedEmails(store.state).size && campaign.contactIds.some(key=>contactedEmails(store.state).has(store.state.contacts.find(c=>c.id===key)?.email?.toLowerCase())))fail('A selected contact has new pending outreach. Review your recipients again.',409);
  const result=await queueCampaign(campaign,data,store,queue,config);return {...result,campaignId:campaign.id,progress:await batchProgress(campaign.id,store)};
}
export async function batchProgress(campaignId,store) {
  const c=store.state.campaigns.find(c=>c.id===campaignId);if(!c)fail('Campaign not found.',404);
  const rows=await store.db.prepare("SELECT t.id,t.kind,t.status,t.run_at,l.status AS send_status FROM tasks t LEFT JOIN outreach_send_log l ON l.task_id=t.id WHERE json_extract(t.payload,'$.campaignId')=? ORDER BY t.created_at DESC").all(c.id);
  const first=rows.filter(r=>r.kind==='campaign.send'),status=r=>r.send_status==='accepted'?'accepted':r.send_status==='unknown' || r.status==='unknown'?'unknown':r.status==='queued'?'queued':r.status==='running'?'sending':r.send_status || r.status;
  const next=rows.filter(r=>r.status==='queued').sort((a,b)=>a.run_at-b.run_at)[0];
  return {campaignId:c.id,name:c.name,status:c.status,total:c.contactIds.length,sent:first.filter(r=>status(r)==='accepted').length,queued:first.filter(r=>status(r)==='queued').length,sending:first.filter(r=>status(r)==='sending').length,failed:first.filter(r=>status(r)==='failed').length,unknown:first.filter(r=>status(r)==='unknown').length,cancelled:first.filter(r=>status(r)==='cancelled').length,followupsQueued:rows.filter(r=>r.kind==='campaign.followup' && r.status==='queued').length,nextSendAt:next?new Date(Number(next.run_at)).toISOString():null,updatedAt:now()};
}
export async function controlQuickBatch(campaignId,action,store,queue,config={}) {
  const c=store.state.campaigns.find(c=>c.id===campaignId && c.studio);if(!c)fail('Mail batch not found.',404);
  if(action==='pause') {
    c.status='Paused';const tasks=await store.db.prepare("SELECT id FROM tasks WHERE status='queued' AND json_extract(payload,'$.campaignId')=?").all(c.id);for(const task of tasks)await queue.cancel(task.id);
    for(const d of c.deliveries)if(d.status==='queued')d.status='cancelled';await store.save();return {progress:await batchProgress(c.id,store),message:'Pending messages paused. A request already accepted by the mail provider cannot be recalled.'};
  }
  if(c.status==='Paused')fail('This campaign is paused. Review a new draft before queueing more mail.',409);
  if(action==='next') {
    const task=await store.db.prepare("SELECT id,payload,run_at FROM tasks WHERE status='queued' AND kind='campaign.send' AND json_extract(payload,'$.campaignId')=? ORDER BY run_at LIMIT 1").get(c.id);if(!task)fail('There is no queued first email in this batch.',409);
    const payload=JSON.parse(task.payload),lease=await store.db.prepare('SELECT not_before FROM send_leases WHERE account_id=?').get(payload.accountId),earliest=Math.max(Date.now(),Number(lease?.not_before)||0);
    const slot=c.deliveryMode==='test'?earliest:businessSlot(earliest,store.state.settings.sendTimeZone || 'UTC');
    await store.db.prepare("UPDATE tasks SET run_at=?,updated_at=? WHERE id=? AND status='queued'").run(slot,Date.now(),task.id);return {progress:await batchProgress(c.id,store),message:slot>Date.now()+1000?'Moved to the next permitted account slot.':'The next reviewed message is ready for the worker.'};
  }
  if(action==='retry') {
    if(!c.approval || campaignFingerprint(c,store.state)!==c.approval.fingerprint)fail('Approved content changed. Review a fresh draft.',409);
    // Retry only explicit provider rejection, never a timeout/ambiguous send.
    const failed=await store.db.prepare("SELECT t.id FROM tasks t JOIN outreach_send_log l ON l.task_id=t.id WHERE t.kind='campaign.send' AND t.status='failed' AND l.status='failed' AND json_extract(t.payload,'$.campaignId')=?").all(c.id);
    if(!failed.length)fail('No safely retryable failures. Unknown sends must be reconciled with the mailbox.',409);
    await store.db.exec('BEGIN IMMEDIATE');try{for(const task of failed){await store.db.prepare("UPDATE tasks SET status='queued',attempts=0,run_at=?,updated_at=? WHERE id=? AND status='failed'").run(Date.now(),Date.now(),task.id);await store.db.prepare("UPDATE outreach_send_log SET status='queued',updated_at=? WHERE task_id=? AND status='failed'").run(Date.now(),task.id);const d=c.deliveries.find(d=>d.taskId===task.id);if(d)d.status='queued';}c.status='Queued';await store.save(true);await store.db.exec('COMMIT');}catch(e){await store.db.exec('ROLLBACK');throw e;}
    return {progress:await batchProgress(c.id,store),message:`${failed.length} explicitly rejected message(s) queued for retry.`};
  }
  fail('Unsupported batch action.');
}
