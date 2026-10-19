import { id, now, suggestStage, safeUrl } from "../domain.mjs";
export const INBOX_SYNC_INTERVAL=15*60000;
// Polling is also a fallback when Gmail Pub/Sub or Graph webhooks are not set up.
export async function scheduleMailboxSync(store,queue,clock=Date.now()) {
  let queued=0;
  for(const account of await store.db.prepare('SELECT id FROM mail_accounts').all()) {
    const key=`mailbox:${account.id}`;
    await store.db.exec('BEGIN IMMEDIATE');
    try {
      const schedule=await store.db.prepare('SELECT next_run FROM autopilot_schedule WHERE id=?').get(key);
      if(!schedule || schedule.next_run<=clock) {
        await queue.enqueue('inbox.sync',{accountId:account.id},{dedupeKey:`periodic-inbox-${account.id}-${Math.floor(clock/INBOX_SYNC_INTERVAL)}`});
        await store.db.prepare('INSERT INTO autopilot_schedule(id,next_run,cursor) VALUES(?,?,0) ON CONFLICT(id) DO UPDATE SET next_run=excluded.next_run').run(key,clock+INBOX_SYNC_INTERVAL);
        queued++;
      }
      await store.db.exec('COMMIT');
    } catch(error) {await store.db.exec('ROLLBACK');throw error;}
  }
  return queued;
}
const address = from => from.match(/<?([^\s<>]+@[^\s<>]+)>?/)?.[1]?.toLowerCase() || "";
const clean = s => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function shouldClassify(message, state) {
  const sender = address(message.from),
    domain = sender.split("@")[1] || "",
    content = clean(`${message.subject} ${message.body}`),
    hasSubject = /application|interview|assessment|next steps|offer|update|rejected/i.test(message.subject);
  const ats = /(^|\.)(greenhouse\.io|hire\.lever\.co|myworkday\.com|ashbyhq\.com)$/.test(domain);
  return Boolean(ats && hasSubject || state.applications.some(a => {
    const j = state.jobs.find(j => j.id === a.jobId);
    return j && (content.includes(clean(j.company)) && content.includes(clean(j.title)) || j.companyDomain === domain && hasSubject);
  }));
}
export function classifyEmail(message, state) {
  const body = message.body.split(/\nOn .+wrote:|\n_{5,}|\nFrom:/i)[0],
    combined = `${message.subject}\n${body}`;
  const assessment = /hackerrank|codesignal|coding (?:test|assessment)|online assessment/i.test(combined);
  const proposedStage = message.aiClassification ? message.aiClassification.confidence >= 0.9 && message.aiClassification.stage !== "Unknown" ? message.aiClassification.stage : null : suggestStage(message.subject, body);
  const links = [...combined.matchAll(/https?:\/\/[^\s<>"')]+/gi)].map(m => safeUrl(m[0])).filter(Boolean);
  const deadline = combined.match(/(?:deadline|due(?:\s+by)?)\s*:?\s*(\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d\d:\d\d)?)?)/i)?.[1] || null;
  const sender = address(message.from),
    knownATS = /(?:greenhouse\.io|hire\.lever\.co|myworkday\.com|ashbyhq\.com)$/.test(sender.split("@")[1] || "");
  const candidates = state.applications.filter(a => {
    const j = state.jobs.find(j => j.id === a.jobId);
    if (!j) return false;
    const title = clean(j.title),
      company = clean(j.company),
      hay = clean(combined);
    return title.length >= 4 && hay.includes(title) && (hay.includes(company) || knownATS || Boolean(j.companyDomain && sender.endsWith(`@${j.companyDomain}`)));
  });
  return {
    proposedStage,
    applicationId: candidates.length === 1 ? candidates[0].id : null,
    ambiguous: candidates.length > 1,
    candidates: candidates.map(a => a.id),
    sender,
    deadline,
    links,
    body
  };
}
const ranks = {
  Saved: 0,
  Ready: 1,
  Applied: 2,
  Assessment: 3,
  Interview: 4,
  "Interview scheduled": 5,
  Offer: 6
};
export async function ingestMessage(message, store) {
  const s = store.state;
  if (message.outbound) return {
    ignored: true
  };
  const sender=address(message.from);
  const latest=String(message.body || '').split(/\nOn .+wrote:|\n_{5,}|\nFrom:/i)[0];
  if (/\bunsubscribe\b|\bremove me\b|\bstop (?:emailing|contacting) me\b/i.test(latest))
    for (const contact of s.contacts) if (contact.email?.toLowerCase() === sender) {contact.suppressed=true;contact.suppressedAt=now();}
  // A reply from an actual recipient stops that company's follow-ups even if
  // it arrives in a new thread. An unrelated newsletter cannot stop sequences.
  const replyDomains=new Set(s.contacts.filter(c=>c.email?.toLowerCase()===sender).map(c=>c.companyDomain || c.email.split('@')[1]));
  for (const c of s.campaigns) for (const d of c.deliveries || []) {
    const recipient = s.contacts.find(x => x.id === d.contactId);
    if (recipient && replyDomains.has(recipient.companyDomain || recipient.email?.split('@')[1])) {
      d.repliedAt = message.receivedAt;
      d.followupStopped = true;
      if(d.followupTaskId) await store.db.prepare("UPDATE tasks SET status='cancelled',updated_at=? WHERE id=? AND kind='campaign.followup' AND status='queued'").run(Date.now(),d.followupTaskId);
    }
  }
  if (s.inbox.some(x => x.messageId === message.id)) {
    await store.save();
    return {
      duplicate: true
    };
  }
  if (!shouldClassify(message, s)) {
    await store.save();
    return {
      ignored: true
    };
  }
  const result = classifyEmail(message, s);
  if(result.applicationId && ['Interview','Interview scheduled','Offer','Rejected'].includes(result.proposedStage)) {
    const application=s.applications.find(a=>a.id===result.applicationId),job=s.jobs.find(j=>j.id===application?.jobId);
    if(job) for(const campaign of s.campaigns.filter(c=>c.jobId===job.id || job.companyDomain && c.autopilot?.domain===job.companyDomain)) for(const delivery of campaign.deliveries || []) {
      delivery.followupStopped=true;
      if(delivery.followupTaskId) await store.db.prepare("UPDATE tasks SET status='cancelled',updated_at=? WHERE id=? AND kind='campaign.followup' AND status='queued'").run(Date.now(),delivery.followupTaskId);
    }
  }
  if (!result.proposedStage && !result.deadline) {
    await store.save();
    return {
      ignored: true
    };
  }
  const item = {
    id: id(),
    messageId: message.id,
    applicationId: result.applicationId,
    from: message.from,
    subject: message.subject,
    body: result.body,
    proposedStage: result.proposedStage,
    status: "Needs review",
    createdAt: now(),
    receivedAt: message.receivedAt,
    deadline: message.aiClassification?.deadline || result.deadline,
    classification: message.aiClassification || null,
    links: result.links,
    ambiguous: result.ambiguous,
    candidateIds: result.candidates
  };
  if (s.settings.inboxAutoUpdate && result.applicationId && result.proposedStage) {
    const a = s.applications.find(a => a.id === result.applicationId);
    const oldTime = a.lastEmailAt ? Date.parse(a.lastEmailAt) : 0;
    const timely = Date.parse(message.receivedAt) >= oldTime;
    const terminal = ["Offer", "Rejected", "Withdrawn"].includes(a.stage);
    const forward = result.proposedStage === "Rejected" || (ranks[result.proposedStage] ?? -1) >= (ranks[a.stage] ?? 0);
    if (timely && !terminal && forward) {
      a.stage = result.proposedStage;
      a.updatedAt = now();
      a.lastEmailAt = message.receivedAt;
      a.history.push({
        stage: a.stage,
        at: now(),
        source: `Mailbox sync: ${message.subject}`
      });
      item.status = "Auto-applied";
    }
  }
  s.inbox.unshift(item);
  await store.save();
  return {
    item
  };
}
