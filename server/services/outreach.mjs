import { unsubscribeLink } from "./unsubscribe.mjs";
import { hydrateResume } from "./resume-storage.mjs";
import { randomInt } from "node:crypto";
import { fail, now, hash, renderTemplate, previewCampaign, campaignFingerprint, sampleEmail } from "../domain.mjs";
import { accessAccount } from "../providers/mail/oauth.mjs";
import { sendNative } from "../providers/mail/native.mjs";
import { sendResend } from "../providers/mail/resend.mjs";
import { getPolicy, policyAllows, activity } from "./autopilot-policy.mjs";
export function businessSlot(earliest, timeZone = "UTC") {
  let time = Math.ceil(earliest / 60000) * 60000;
  let format;
  try {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      weekday: "short",
      hour: "2-digit"
    });
  } catch {
    fail("Enter a valid IANA time zone.");
  }
  for (let i = 0; i < 15 * 24 * 60; i++) {
    const parts = Object.fromEntries(format.formatToParts(time).map(p => [p.type, p.value]));
    if (!["Sat", "Sun"].includes(parts.weekday) && Number(parts.hour) >= 9 && Number(parts.hour) < 11) return time;
    time += 60000;
  }
  fail("Could not find a business-hour sending slot.");
}
export function afterBusinessDays(time, count) {
  let result = new Date(time);
  for (let i = 0; i < count;) {
    result = new Date(result.getTime() + 86400000);
    if (![0, 6].includes(result.getUTCDay())) i++;
  }
  return result.getTime();
}
export async function queueCampaign(c, data, store, queue, config, options = {}) {
  const s = store.state,
    p = s.previews[data.previewId];
  if (!p || p.campaignId !== c.id || p.expires < Date.now() || p.fingerprint !== campaignFingerprint(c, s)) fail("Review this campaign again; the preview expired or changed.", 409);
  const preview = previewCampaign(c, s);
  if (data.approved !== true || data.confirmCount !== preview.messages.length) fail("Approve the reviewed recipient count.");
  if (config.ENABLE_LIVE_SEND !== "true") fail("Live sending is disabled on this server.", 503);
  if (!await policyAllows(store,c)) fail("Autopilot is paused or its settings/profile changed.",409);
  const policy = c.autopilot ? await getPolicy(store) : null;
  if (preview.messages.some(m => m.isDemo || m.emailStatus !== "verified") || sampleEmail(s.profile.email)) fail("Sending requires verified real contacts and a real sender profile.");
  if (c.accountId) {
    if (!(await store.db.prepare("SELECT id FROM mail_accounts WHERE id=?").get(c.accountId))) fail("Connect the selected mailbox first.");
  } else if (!config.RESEND_API_KEY || !config.EMAIL_FROM) fail("Connect a mailbox or configure Resend.", 503);
  const recipients = preview.messages.filter(m => !c.deliveries.some(d => d.contactId === m.contactId && ["queued", "sending", "accepted", "unknown"].includes(d.status)));
  if (!recipients.length) fail("These recipients are already queued, accepted, or need reconciliation.", 409);
  const limit = Math.max(1, Math.min(50, policy?.dailySendLimit || Number(s.settings.dailySendLimit) || 30)),
    zone = policy?.timeZone || s.settings.sendTimeZone || "UTC";
  let cursor = Date.now();
  const accountId = c.accountId || "resend";
  const minDelay=policy?.minDelayMinutes || 3,maxDelay=policy?.maxDelayMinutes || 8;
  const jitter=()=>randomInt(minDelay*60000,maxDelay*60000+1);
  // Commit approval and the complete outbox atomically; no partially queued campaign.
  if (!options.inTransaction) await store.db.exec("BEGIN IMMEDIATE");
  try {
    const reserved = await store.db.prepare("SELECT run_at FROM tasks WHERE kind IN ('campaign.send','campaign.followup') AND status NOT IN ('cancelled','failed') AND json_extract(payload,'$.accountId')=? ORDER BY run_at DESC").all(accountId);
    const booked = reserved.map(r => r.run_at);
    for (const m of recipients) {
      const domain=m.to.split('@')[1].toLowerCase();
      const companyReservations=await store.db.prepare("SELECT email FROM outreach_company_budget WHERE domain=? AND (status IN ('queued','sending','unknown') OR status='accepted' AND updated_at>?)").all(domain,Date.now()-14*86400000);
      if(companyReservations.filter(r=>r.email!==m.to.toLowerCase()).length>=(policy?.contactsPerCompany || 3)) fail('The 14-day contact limit for this company has been reached.',409);
      if(c.autopilot && await store.db.prepare("SELECT task_id FROM outreach_send_log WHERE contact_email=? AND campaign_id!=? AND status IN ('queued','sending','accepted','unknown') AND updated_at>?").get(m.to.toLowerCase(),c.id,Date.now()-30*86400000))
        fail("A recipient already has recent or pending outreach. Refresh the review queue.",409);
      let slot = businessSlot(cursor, zone);
      // Fill available slots before future follow-ups instead of pushing every
      // new campaign behind the farthest reservation in the account.
      for (;;) {
        if (booked.filter(at => new Date(at).toISOString().slice(0, 10) === new Date(slot).toISOString().slice(0, 10)).length >= limit) {
          slot = businessSlot(slot + 86400000, zone); continue;
        }
        const collision=booked.filter(at=>Math.abs(at-slot)<minDelay*60000);
        if(!collision.length) break;
        slot=businessSlot(Math.max(...collision)+jitter(),zone);
      }
      const key = hash([c.id, m.contactId, c.subject, c.body, c.sequence || null]);
      const task = await queue.enqueue("campaign.send", {
        campaignId: c.id,
        contactId: m.contactId,
        accountId,
        approvedHash: p.fingerprint
      }, {
        runAt: slot,
        dedupeKey: `mail-${key}-${c.deliveries.filter(d => d.contactId === m.contactId).length}`,
        maxAttempts: 1
      });
      const reservation = await store.db.prepare("INSERT INTO outreach_send_log(user_id,contact_email,campaign_id,sequence_step,task_id,status,updated_at) VALUES('local',?,?,0,?,'queued',?) ON CONFLICT(user_id,contact_email,campaign_id,sequence_step) DO UPDATE SET task_id=excluded.task_id,status='queued',updated_at=excluded.updated_at WHERE outreach_send_log.status IN ('failed','cancelled')").run(m.to.toLowerCase(),c.id,task.id,Date.now());
      if (!reservation.changes) fail("This address already has a send reserved in this campaign.",409);
      await store.db.prepare("INSERT INTO outreach_company_budget(domain,email,task_id,status,updated_at) VALUES(?,?,?,'queued',?) ON CONFLICT(domain,email) DO UPDATE SET task_id=excluded.task_id,status='queued',updated_at=excluded.updated_at")
        .run(domain,m.to.toLowerCase(),task.id,Date.now());
      c.deliveries.push({
        key,
        taskId: task.id,
        contactId: m.contactId,
        status: "queued",
        scheduledAt: new Date(slot).toISOString()
      });
      booked.push(slot);
      cursor = slot + jitter();
    }
    c.status = "Queued";
    c.approval = {
      fingerprint: p.fingerprint,
      at: now()
    };
    await store.save(true);
    if (!options.inTransaction) await store.db.exec("COMMIT");
  } catch (e) {
    try {
      if (!options.inTransaction) await store.db.exec("ROLLBACK");
    } catch {}
    throw e;
  }
  return {
    status: c.status,
    deliveries: c.deliveries
  };
}
export async function deliverTask(task, store, queue, config, fetcher = fetch) {
  const s = store.state,
    c = s.campaigns.find(c => c.id === task.payload.campaignId),
    contact = s.contacts.find(c => c.id === task.payload.contactId);
  if (c?.autopilot && !await policyAllows(store,c)) return {status:"cancelled",reason:"Autopilot was paused, or its settings/profile changed."};
  if (c?.autopilot && (!s.jobs.some(j=>j.id===c.jobId && !j.archived))) return {status:"cancelled",reason:"This discovered job is no longer active."};
  const policy = c?.autopilot ? await getPolicy(store) : null;
  if (c?.resumeShare) {
    const share=await store.db.prepare("SELECT revoked,expires FROM public_resumes WHERE id=?").get(c.resumeShare.id);
    if (!share || share.revoked || share.expires<Date.now()) return {status:"cancelled",reason:"The résumé link expired or was revoked. Review a fresh draft."};
  }
  if (!c || !contact || contact.suppressed || contact.emailStatus !== "verified" || contact.isDemo || sampleEmail(contact.email) || config.ENABLE_LIVE_SEND !== "true") return {
    status: "cancelled",
    reason: "Campaign, contact, verification, or sending permission is no longer valid."
  };
  const d = c.deliveries.find(d => d.contactId === contact.id && d.taskId === (task.payload.parentTaskId || task.id)) || [...c.deliveries].reverse().find(d => d.contactId === contact.id);
  if (!d) return {
    status: "cancelled"
  };
  const followup = task.kind === "campaign.followup";
  if (followup && (d.repliedAt || d.followupStopped || !c.sequence?.enabled)) return {
    status: "cancelled",
    reason: "A reply, pause, or suppression stopped the sequence."
  };
  if (!followup && ["accepted", "sending", "unknown"].includes(d.status)) return {
    status: "unknown",
    reason: "A previous send needs reconciliation."
  };
  if (!c.approval || task.payload.approvedHash !== c.approval.fingerprint || campaignFingerprint(c, s) !== c.approval.fingerprint) return {
    status: "cancelled",
    reason: "Approved content or contacts changed. Preview and approve again."
  };
  if (followup && !d.threadId) return {
    status: "cancelled",
    reason: "A provider thread ID is required for follow-ups."
  };
  const m = previewCampaign(c, s).messages.find(m => m.contactId === contact.id);
  if (!m) return {
    status: "cancelled"
  };
  if (c.accountId) {
    const account = await accessAccount(c.accountId, store, config, fetcher);
    if (Date.now() - Date.parse(account.metadata.lastSync || 0) > 15 * 60000 && followup) return {
      status: "cancelled",
      reason: "Inbox sync must be current before a follow-up can send."
    };
  }
  if (followup) {
    m.body = `${renderTemplate(c.sequence.body, contact, s.profile)}\n\n${s.profile.name}\n${s.profile.email}\nReply with “unsubscribe” to stop receiving messages.`;
    m.threadId = d.threadId;
    m.inReplyTo = d.internetMessageId;
    m.replyToProviderId = d.providerId;
  }
  const currentTime = Date.now(),
    zone = policy?.timeZone || s.settings.sendTimeZone || "UTC",
    slot = businessSlot(currentTime, zone);
  if (slot - currentTime > 60000) return {
    status: "deferred",
    runAt: slot
  };
  const budgetAccount = c.accountId || "resend",
    day = new Date(currentTime).toISOString().slice(0, 10),
    limit = Math.max(1, Math.min(50, policy?.dailySendLimit || Number(s.settings.dailySendLimit) || 30));
  await store.db.exec("BEGIN IMMEDIATE");
  try {
    const lease = await store.db.prepare("SELECT not_before FROM send_leases WHERE account_id=?").get(budgetAccount);
    const used = (await store.db.prepare("SELECT count FROM send_budget WHERE account_id=? AND day=?").get(budgetAccount, day))?.count || 0;
    if (used >= limit || lease && lease.not_before > currentTime) {
      await store.db.exec("COMMIT");
      return {
        status: "deferred",
        runAt: businessSlot(used >= limit ? currentTime + 86400000 : lease.not_before, zone)
      };
    }
    const claimed = await store.db.prepare("INSERT INTO outreach_send_log(user_id,contact_email,campaign_id,sequence_step,task_id,status,updated_at) VALUES('local',?,?,?,?,'sending',?) ON CONFLICT(user_id,contact_email,campaign_id,sequence_step) DO UPDATE SET status='sending',updated_at=excluded.updated_at WHERE outreach_send_log.status='queued' AND outreach_send_log.task_id=excluded.task_id").run(contact.email.toLowerCase(),c.id,followup ? 1 : 0,task.id,Date.now());
    if (!claimed.changes) {
      await store.db.exec("COMMIT");
      return {status:"cancelled",reason:"This campaign step was already attempted for this address; reconcile its send log."};
    }
    await store.db.prepare("INSERT INTO send_leases(account_id,not_before) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET not_before=excluded.not_before").run(budgetAccount, currentTime + randomInt((policy?.minDelayMinutes || 3)*60000,(policy?.maxDelayMinutes || 8)*60000+1));
    await store.db.prepare("INSERT INTO send_budget(account_id,day,count) VALUES(?,?,1) ON CONFLICT(account_id,day) DO UPDATE SET count=count+1").run(budgetAccount, day);
    await store.db.exec("COMMIT");
  } catch (error) {
    await store.db.exec("ROLLBACK");
    throw error;
  }
  if (followup) d.followupStatus = "sending";else d.status = "sending";
  d.at = now();
  await store.save();
  m.unsubscribeUrl = await unsubscribeLink(contact.email,store,config);
  m.body += `\n\nUnsubscribe: ${m.unsubscribeUrl}`;
  await queue.log(task.id, "Sending the approved message.");
  const result = c.accountId ? await sendNative(m, c.accountId, store, config, c.attachResume && !followup ? await hydrateResume(s.resume, store, config) : null, fetcher, async metadata => {
    Object.assign(d, metadata);
    await store.save();
  }) : await sendResend({
    ...m,
    replyTo: s.profile.email
  }, config, c.attachResume ? await hydrateResume(s.resume, store, config) : null, d.key, fetcher);
  await store.db.prepare("UPDATE outreach_send_log SET status=?,provider_id=?,updated_at=? WHERE task_id=?").run(result.status,result.providerId || null,Date.now(),task.id);
  await store.db.prepare('UPDATE outreach_company_budget SET status=?,updated_at=? WHERE task_id=?').run(result.status,Date.now(),task.id);
  if (followup) d.followupStatus = result.status;else Object.assign(d, result);
  d.at = now();
  const latest = [...new Map(c.deliveries.map(x => [x.contactId, x])).values()];
  c.status = latest.every(x => x.status === "accepted") ? "Accepted by provider" : latest.some(x => ["unknown", "failed"].includes(x.status)) ? "Needs attention" : "Queued";
  await store.save();
  if(c.autopilot) await activity(store,"delivery",`${c.name}: ${followup ? "follow-up" : "pitch"} ${result.status === "accepted" ? "accepted by the mail provider" : result.status}.`,1);
  if (result.status === "accepted" && !followup && c.sequence?.enabled && c.accountId) {
    const runAt = businessSlot(afterBusinessDays(Date.now(), c.sequence.afterBusinessDays || 4), policy?.timeZone || s.settings.sendTimeZone || "UTC");
    const next = await queue.enqueue("campaign.followup", {
      ...task.payload,
      parentTaskId: task.id
    }, {
      runAt,
      dedupeKey: `followup-${task.id}`,
      maxAttempts: 1
    });
    d.followupTaskId = next.id;
    await store.save();
  }
  return result;
}
