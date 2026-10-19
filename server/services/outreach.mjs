import { unsubscribeLink } from "./unsubscribe.mjs";
import { hydrateResume } from "./resume-storage.mjs";
import { randomInt } from "node:crypto";
import { fail, now, hash, renderTemplate, previewCampaign, campaignFingerprint, sampleEmail } from "../domain.mjs";
import { accessAccount } from "../providers/mail/oauth.mjs";
import { sendNative } from "../providers/mail/native.mjs";
import { sendResend } from "../providers/mail/resend.mjs";
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
export async function queueCampaign(c, data, store, queue, config) {
  const s = store.state,
    p = s.previews[data.previewId];
  if (!p || p.campaignId !== c.id || p.expires < Date.now() || p.fingerprint !== campaignFingerprint(c, s)) fail("Review this campaign again; the preview expired or changed.", 409);
  const preview = previewCampaign(c, s);
  if (data.approved !== true || data.confirmCount !== preview.messages.length) fail("Approve the reviewed recipient count.");
  if (config.ENABLE_LIVE_SEND !== "true") fail("Live sending is disabled on this server.", 503);
  if (preview.messages.some(m => m.isDemo || m.emailStatus !== "verified") || sampleEmail(s.profile.email)) fail("Sending requires verified real contacts and a real sender profile.");
  if (c.accountId) {
    if (!(await store.db.prepare("SELECT id FROM mail_accounts WHERE id=?").get(c.accountId))) fail("Connect the selected mailbox first.");
  } else if (!config.RESEND_API_KEY || !config.EMAIL_FROM) fail("Connect a mailbox or configure Resend.", 503);
  const recipients = preview.messages.filter(m => !c.deliveries.some(d => d.contactId === m.contactId && ["queued", "sending", "accepted", "unknown"].includes(d.status)));
  if (!recipients.length) fail("These recipients are already queued, accepted, or need reconciliation.", 409);
  const limit = Math.max(1, Math.min(50, Number(s.settings.dailySendLimit) || 30)),
    zone = s.settings.sendTimeZone || "UTC";
  let cursor = Date.now();
  const accountId = c.accountId || "resend";
  const reserved = await store.db.prepare("SELECT run_at FROM tasks WHERE kind IN ('campaign.send','campaign.followup') AND status NOT IN ('cancelled','failed') AND json_extract(payload,'$.accountId')=? ORDER BY run_at DESC").all(accountId);
  if (reserved.length) cursor = Math.max(cursor, reserved[0].run_at + 180000);
  const booked = reserved.map(r => r.run_at);
  // Commit approval and the complete outbox atomically; no partially queued campaign.
  await store.db.exec("BEGIN IMMEDIATE");
  try {
    for (const m of recipients) {
      let slot = businessSlot(cursor, zone);
      while (booked.filter(at => new Date(at).toISOString().slice(0, 10) === new Date(slot).toISOString().slice(0, 10)).length >= limit) slot = businessSlot(slot + 86400000, zone);
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
      c.deliveries.push({
        key,
        taskId: task.id,
        contactId: m.contactId,
        status: "queued",
        scheduledAt: new Date(slot).toISOString()
      });
      booked.push(slot);
      cursor = slot + randomInt(180000, 480001);
    }
    c.status = "Queued";
    c.approval = {
      fingerprint: p.fingerprint,
      at: now()
    };
    await store.save(true);
    await store.db.exec("COMMIT");
  } catch (e) {
    try {
      await store.db.exec("ROLLBACK");
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
    zone = s.settings.sendTimeZone || "UTC",
    slot = businessSlot(currentTime, zone);
  if (slot - currentTime > 60000) return {
    status: "deferred",
    runAt: slot
  };
  const budgetAccount = c.accountId || "resend",
    day = new Date(currentTime).toISOString().slice(0, 10),
    limit = Math.max(1, Math.min(50, Number(s.settings.dailySendLimit) || 30));
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
    await store.db.prepare("INSERT INTO send_leases(account_id,not_before) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET not_before=excluded.not_before").run(budgetAccount, currentTime + randomInt(180000, 480001));
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
  if (followup) d.followupStatus = result.status;else Object.assign(d, result);
  d.at = now();
  const latest = [...new Map(c.deliveries.map(x => [x.contactId, x])).values()];
  c.status = latest.every(x => x.status === "accepted") ? "Accepted by provider" : latest.some(x => ["unknown", "failed"].includes(x.status)) ? "Needs attention" : "Queued";
  await store.save();
  if (result.status === "accepted" && !followup && c.sequence?.enabled && c.accountId) {
    const runAt = businessSlot(afterBusinessDays(Date.now(), c.sequence.afterBusinessDays || 4), s.settings.sendTimeZone || "UTC");
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
