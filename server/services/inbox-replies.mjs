import {id,hash,now,fail,emailValid,text} from '../domain.mjs';
import {sendNative} from '../providers/mail/native.mjs';
import {structuredAI} from './ai.mjs';
import {z} from 'zod';
import {withDeadline,boundedFetcher} from '../providers/deadline.mjs';

export function suggestedReplySlots(timeZone,clock=Date.now()){
  let date;try{date=new Intl.DateTimeFormat('en-GB',{timeZone,weekday:'short',day:'numeric',month:'short'});}catch{fail('Choose a valid IANA time zone.');}
  const slots=[];for(let day=1;slots.length<3 && day<10;day++){const value=date.format(clock+day*86400000);if(!/^Sat|^Sun/.test(value))slots.push(`${value} at ${['10:00','14:00','16:00'][slots.length]} (${timeZone})`);}return slots;
}
export async function draftInboxReply(messageId,data,store,config={},fetcher=fetch){
  const item=store.state.inbox.find(m=>m.id===messageId);if(!item)fail('Inbox message not found.',404);if(item.category==='bounce' || item.type==='Delivery failure')fail('Review the delivery failure rather than replying to the automated sender.');
  if(['queued','sending','accepted','unknown'].includes(item.replyDelivery?.status))fail('This reply is already queued or sent. Reconcile its mailbox status before preparing another reply.',409);
  const to=String(item.from || '').match(/<?([^\s<>]+@[^\s<>]+)>?/)?.[1]?.toLowerCase();if(!emailValid(to || '') || /no.?reply|mailer-daemon|postmaster/i.test(to))fail('This message has no replyable sender.');
  const accounts=await store.db.prepare('SELECT id,email FROM mail_accounts').all(),accountId=item.accountId || data.accountId || (accounts.length===1?accounts[0].id:'');if(!accounts.some(a=>a.id===accountId))fail('Choose the connected mailbox that received this message.');
  const timeZone=text(data.timeZone || store.state.settings.sendTimeZone || 'UTC',100),slots=suggestedReplySlots(timeZone),subject=/^Re:/i.test(item.subject)?item.subject:`Re: ${item.subject}`;
  let body=item.category==='interview'?`Thank you for the invitation. I would be glad to speak with you.\n\nWould any of these times work?\n${slots.map(s=>`- ${s}`).join('\n')}\n\nThese are suggested times; I will confirm my calendar before booking.\n\nBest,\n${store.state.profile.name || ''}`:`Thank you for your response${item.category==='positive'?' and for considering my background':''}. I appreciate your time. Please let me know if I can provide any further information.\n\nBest,\n${store.state.profile.name || ''}`,method='Context-based template';
  if(data.useAI===true){
    if(data.confirmed!==true)fail('Approve using this email context with the configured model.');
    if(config.LLM_API_KEY && config.LLM_MODEL)try{const result=await withDeadline(signal=>structuredAI(z.object({body:z.string().min(10).max(3000)}).strict(),'Draft a short factual reply to this incoming email. Do not invent calendar availability, commitments, achievements, personal facts, or acceptance of an offer. For interviews use only the supplied suggested slots and explicitly ask the user to verify availability before booking. Do not include a subject or recipients.',{message:{subject:item.subject,body:item.body},candidateName:store.state.profile.name,slots,draft:body},config,boundedFetcher(fetcher,signal),store),12000);body=result.body;method='Configured model draft';}catch{method='Context-based template · model unavailable';}
  }
  if(data.replyText!==undefined){if(typeof data.replyText!=='string' || !data.replyText.trim() || data.replyText.length>6000)fail('Write a reply up to 6,000 characters.');body=data.replyText.trim();method='Your edited reply';}
  if(/[\r\n]/.test(subject))fail('Reply subject must fit one line.');
  const draft={id:id(),to,subject:subject.slice(0,500),body,accountId,timeZone,slots,method,expires:Date.now()+600000,sourceHash:hash([item.messageId,item.from,item.subject,item.body,item.threadId])};draft.fingerprint=hash(draft);item.replyDraft=draft;await store.save();return {...draft,note:'Review the message and suggested availability. Drafting does not send an email.'};
}
export async function queueInboxReply(messageId,data,store,queue,config={}){
  const item=store.state.inbox.find(m=>m.id===messageId),draft=item?.replyDraft;if(!draft)fail('Prepare a reply draft first.',404);
  if(data.approved!==true || data.fingerprint!==draft.fingerprint)fail('Approve the exact displayed reply.');
  if(['queued','sending','accepted','unknown'].includes(item.replyDelivery?.status))return {existing:true,...item.replyDelivery};
  if(draft.expires<Date.now() || draft.sourceHash!==hash([item.messageId,item.from,item.subject,item.body,item.threadId]))fail('The reply preview expired or changed. Prepare it again.',409);
  if(config.ENABLE_LIVE_SEND!=='true')fail('Live sending is disabled on this server.',503);
  const task=await queue.enqueue('inbox.reply',{messageId,draftId:draft.id,accountId:draft.accountId,fingerprint:draft.fingerprint},{dedupeKey:`inbox-reply:${messageId}:${draft.id}`,maxAttempts:1});item.replyDelivery={taskId:task.id,status:task.status,queuedAt:now()};await store.save();return item.replyDelivery;
}
export async function sendInboxReply(task,store,config={},fetcher=fetch){
  const item=store.state.inbox.find(m=>m.id===task.payload.messageId),draft=item?.replyDraft;if(!item || !draft || draft.id!==task.payload.draftId || draft.fingerprint!==task.payload.fingerprint)return {status:'cancelled'};
  if(['accepted','unknown','sending'].includes(item.replyDelivery?.status))return {status:item.replyDelivery.status==='accepted'?'accepted':'unknown'};
  if(config.ENABLE_LIVE_SEND!=='true'){item.replyDelivery={...item.replyDelivery,status:'cancelled',updatedAt:now(),error:'Live sending disabled.'};await store.save();return {status:'cancelled',reason:'Live sending disabled.'};}
  item.replyDelivery={...item.replyDelivery,status:'sending'};await store.save();
  let result;try{result=await sendNative({to:draft.to,subject:draft.subject,body:draft.body,messageKey:task.id,threadId:item.threadId,inReplyTo:item.internetMessageId,references:item.internetMessageId,replyToProviderId:item.providerId},draft.accountId,store,config,null,fetcher,async metadata=>{Object.assign(item.replyDelivery,metadata);await store.save();});}catch{result={status:'unknown',error:'Reply acceptance is uncertain. Reconcile with the sent mailbox before retrying.'};}
  Object.assign(item.replyDelivery,result,{updatedAt:now()});await store.save();return result;
}
