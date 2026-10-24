import {now,hash,fail,emailValid} from '../domain.mjs';
import {stopFollowups} from './sequences.mjs';
import {verifyWorkEmail} from '../providers/contacts/verification.mjs';
import {effectiveProviderConfig} from './provider-config.mjs';
import {providerCall} from './provider-budget.mjs';
import {observeCompanyEmails} from './company-patterns.mjs';
import {activity} from './autopilot-policy.mjs';
export function deliveryFailure(message){
  const sender=String(message.from || ''),body=String(message.body || '').slice(0,50000);
  if(!/mailer-daemon|postmaster/i.test(sender) || !/undeliver|delivery|address not found|failure|returned mail/i.test(`${message.subject} ${body.slice(0,400)}`))return null;
  if(!/\b5\.1\.[0-3]\b|\b550\b[^\n]*(?:user unknown|no such user|address not found)/i.test(body))return null;
  const email=body.match(/(?:Final-Recipient|Original-Recipient)\s*:\s*(?:rfc822\s*;\s*)?<?([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,})/i)?.[1]?.toLowerCase();
  return email && emailValid(email)?{email,originalId:body.match(/Original-Message-ID\s*:\s*(<[^\r\n]+>)/i)?.[1] || null}:null;
}
export async function recordBounceRecovery(message,store){
  const failure=deliveryFailure(message);if(!failure)return null;
  if(store.state.inbox.some(i=>i.messageId===message.id))return {duplicate:true};
  const logs=await store.db.prepare("SELECT campaign_id,task_id FROM outreach_send_log WHERE contact_email=? AND status='accepted' AND updated_at>? ORDER BY updated_at DESC LIMIT 5").all(failure.email,Date.now()-30*86400000);
  for(const log of logs){const campaign=store.state.campaigns.find(c=>c.id===log.campaign_id),delivery=campaign?.deliveries?.find(d=>d.taskId===log.task_id || d.followupTaskId===log.task_id || d.followups?.some(f=>f.taskId===log.task_id)),contact=store.state.contacts.find(c=>c.id===delivery?.contactId && c.email?.toLowerCase()===failure.email);
    if(!contact || failure.originalId && delivery.internetMessageId && failure.originalId!==delivery.internetMessageId)continue;
    await stopFollowups(delivery,store);campaign.status='Needs attention';Object.assign(delivery,{bounceStatus:'hard-bounce',bounceMessageId:message.id,bouncedAt:now()});
    Object.assign(contact,{emailStatus:'invalid',verification:{provider:'Delivery status notification',status:'invalid',reference:`mail:${message.id}`,at:now(),result:'Hard address failure reported for an accepted message.'},bounceRecovery:{status:'Needs verification and review',messageId:message.id,bouncedEmail:failure.email,alternatives:(contact.alternateEmails || []).filter(email=>email!==failure.email),requiresApproval:true,createdAt:now()}});
    store.state.inbox.unshift({id:hash(['bounce',message.id]),messageId:message.id,from:message.from,subject:message.subject,body:String(message.body || '').slice(0,6000),applicationId:null,proposedStage:null,status:'Needs review',type:'Delivery failure',contactId:contact.id,createdAt:now(),receivedAt:message.receivedAt || now(),links:[]});
    await store.save();await activity(store,'contacts',`${contact.company}: a hard bounce stopped follow-ups. Alternate addresses need verification and a fresh outreach review.`,1);return {handled:true,contactId:contact.id};
  }
  return null;
}
export async function queueBounceRecovery(data,store,queue){
  const contact=store.state.contacts.find(c=>c.id===data.contactId),email=String(data.email || '').trim().toLowerCase();
  if(data.confirmed!==true || data.allowCredits!==true || !contact?.bounceRecovery || contact.suppressed || !contact.bounceRecovery.alternatives?.includes(email) || !email.endsWith(`@${contact.companyDomain || contact.email.split('@')[1]}`))fail('Choose an alternate from a recorded bounce and approve mailbox-verification credit usage.');
  const task=await queue.enqueue('contacts.bounce-recover',{contactId:contact.id,oldEmail:contact.email,email},{dedupeKey:`bounce-recover:${hash([contact.id,contact.email,email,Math.floor(Date.now()/86400000)])}`,maxAttempts:1});return {taskId:task.id,message:'Alternate mailbox verification queued. A new outreach review is required before sending.'};
}
export async function recoverBounceAlternative(task,store,config={},fetcher=fetch,lookupMx){
  const c=store.state.contacts.find(c=>c.id===task.payload.contactId),email=task.payload.email;
  if(!c || c.suppressed || c.email!==task.payload.oldEmail || !c.bounceRecovery?.alternatives.includes(email))return {status:'cancelled'};
  config=await effectiveProviderConfig(store,config);if(!config.HUNTER_API_KEY)fail('Configure Hunter mailbox verification before selecting a bounce alternative.',503);
  const result=await providerCall(store,`bounce-verify:${hash(config.HUNTER_API_KEY)}:${email}:${Math.floor(Date.now()/86400000)}`,'Hunter',Math.min(100,Number(config.CONTACT_API_DAILY_LIMIT)||20),()=>verifyWorkEmail(email,config,fetcher,lookupMx));
  await store.refresh();const contact=store.state.contacts.find(v=>v.id===c.id);if(!contact || contact.email!==task.payload.oldEmail || contact.suppressed)return {status:'cancelled'};
  if(result.emailStatus!=='verified'){contact.bounceRecovery.lastCheck={email,status:result.emailStatus,at:now()};await store.save();return {status:'Needs review',emailStatus:result.emailStatus};}
  const old=contact.email;Object.assign(contact,result,{email,emailInferred:false,alternateEmails:(contact.alternateEmails || []).filter(v=>v!==email && v!==old),rejectedEmails:[...(contact.rejectedEmails || []),old],bounceRecovery:{...contact.bounceRecovery,status:'Verified alternate saved; review a new mail batch',selectedEmail:email,verifiedAt:now(),requiresApproval:true}});
  await observeCompanyEmails(store,{domain:contact.companyDomain,name:contact.company},[contact]);await store.save();return {emailStatus:'verified',requiresApproval:true};
}
