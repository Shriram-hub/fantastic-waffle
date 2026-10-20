import {fail,text} from '../domain.mjs';
export const DEFAULT_FOLLOWUPS=[
  {afterBusinessDays:4,body:'Hi {{first_name}}, following up on my note about {{job_title}} at {{company}}. Would you be the right person to contact about this opportunity?'},
  {afterBusinessDays:8,body:'Hi {{first_name}}, one final follow-up on my introduction. If the timing is not right, I understand. Thank you for considering my background.'},
];
export function sequenceSteps(sequence) {
  if(!sequence?.enabled)return [];
  return sequence.steps || [{afterBusinessDays:sequence.afterBusinessDays || 4,body:sequence.body}];
}
export function normalizeSequence(value,accountId) {
  if(!value?.enabled)return {enabled:false};
  const raw=sequenceSteps(value);if(!accountId || !raw.length || raw.length>3)fail('Sequences require a connected mailbox and 1–3 reviewed follow-up steps.');
  let previous=0;
  const steps=raw.map(step=>{
    const days=Number(step.afterBusinessDays),body=text(step.body,3000);
    if(!Number.isInteger(days) || days<=previous || days>30 || !body)fail('Use ascending business-day offsets (1–30) and a message for every follow-up.');
    previous=days;return {afterBusinessDays:days,body};
  });
  return {enabled:true,steps,afterBusinessDays:steps[0].afterBusinessDays,body:steps[0].body};
}
export async function stopFollowups(delivery,store) {
  delivery.followupStopped=true;
  for(const taskId of new Set([delivery.followupTaskId,...(delivery.followups || []).map(s=>s.taskId)].filter(Boolean))) {
    await store.db.prepare("UPDATE tasks SET status='cancelled',updated_at=? WHERE id=? AND kind='campaign.followup' AND status='queued'").run(Date.now(),taskId);
    await store.db.prepare("UPDATE outreach_send_log SET status='cancelled',updated_at=? WHERE task_id=? AND status='queued'").run(Date.now(),taskId);
  }
  for(const step of delivery.followups || [])if(step.status==='queued')step.status='cancelled';
}
