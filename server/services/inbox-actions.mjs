import {hash,now} from '../domain.mjs';
import {prepFingerprint,saveCareerTask} from './career.mjs';
import {queueAlert} from './notifications.mjs';
import {activity} from './autopilot-policy.mjs';
export async function inboxActions(item,store,queue,config={}) {
  if(!item || !queue || item.actionsQueued || !item.applicationId || item.ambiguous || item.status==='Dismissed')return;
  const application=store.state.applications.find(a=>a.id===item.applicationId),job=store.state.jobs.find(j=>j.id===application?.jobId);
  if(!job || ['Rejected','Withdrawn','Offer'].includes(application.stage) || application.lastEmailAt && Date.parse(item.receivedAt)<Date.parse(application.lastEmailAt))return;
  const kind=['Interview','Interview scheduled'].includes(item.proposedStage) ? 'interview' : item.proposedStage==='Assessment' ? 'assessment' : null;
  if(!kind)return;
  if(kind==='interview' && store.state.settings.autoInterviewPrep!==false) {
    const useAI=store.state.settings.autoInterviewPrepAI===true && !!config.LLM_API_KEY;
    await queue.enqueue('career.prep',{jobId:job.id,useAI,fingerprint:prepFingerprint(store,job,useAI),trigger:'inbox',messageId:item.messageId},{dedupeKey:`inbox-prep-${hash(item.messageId)}`,maxAttempts:2});
  }
  const title=`${kind==='interview' ? 'Prepare for interview' : 'Review assessment'} · ${job.company} · ${job.title}`;
  if(!(store.state.career?.tasks || []).some(t=>t.sourceMessageId===item.messageId) && (store.state.career?.tasks || []).length<500) {
    const dueAt=item.deadline && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(item.deadline) && Number.isFinite(Date.parse(item.deadline)) ? item.deadline : null;
    const task=await saveCareerTask({title:title.slice(0,200),kind:kind==='interview' ? 'Interview' : 'Assessment',jobId:job.id,dueAt,notes:`Detected in: ${item.subject}\n${(item.links || []).join('\n')}\nReview the email for the exact schedule and requirements.`},store);task.sourceMessageId=item.messageId;
  }
  await queueAlert(kind,`${kind==='interview' ? 'Interview invitation' : 'Assessment update'}: ${job.company} · ${job.title}${item.deadline ? ` · Deadline in email: ${item.deadline}` : ''}. Review your inbox for details.`,item.messageId,store,queue);
  item.actionsQueued=now();await store.save();await activity(store,'career',`${job.company}: ${kind==='interview' ? 'interview preparation queued' : 'assessment action added'} from a uniquely matched inbox update.`,1);
}
