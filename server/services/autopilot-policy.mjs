import { fail, hash, id, now, emailValid, sampleEmail } from "../domain.mjs";
import { resumeHash } from "./resume-storage.mjs";

export const AUTOPILOT_DEFAULTS = Object.freeze({
  enabled: false, approvalMode: "review", minimumMatchScore: 80,
  dailySendLimit: 40, contactsPerCompany: 3, maxContactLookupsPerDay: 20,
  minDelayMinutes:3,maxDelayMinutes:8,freeContactFallback:true,
  allowContactCredits: false, useAI: false, useSearchAPI: false, resumeMode: "link",
  accountId: "", timeZone: "UTC", country: "", followup: false,
});
export async function getPolicy(store) {
  const row = await store.db.prepare("SELECT body FROM autopilot_config WHERE id='local'").get();
  return { ...AUTOPILOT_DEFAULTS, ...(row ? JSON.parse(row.body) : {}) };
}
export const profileScope = s => hash({
  profile: s.profile, resume: resumeHash(s.resume), text: s.resume?.text || "",
});
export async function activity(store, kind, message, count = null) {
  await store.db.prepare("INSERT INTO autopilot_activity(id,at,kind,message,count) VALUES(?,?,?,?,?)")
    .run(id(), Date.now(), kind, String(message).slice(0, 500), count);
  await store.db.prepare("DELETE FROM autopilot_activity WHERE at<?").run(Date.now() - 30 * 86400000);
}
export async function pipelineBlockers(store, config, policy) {
  const s = store.state, discovery = [], contacts = [], sending = [];
  if (s.isDemo) discovery.push("Start a personal workspace first.");
  if (!s.resume?.text?.trim()) discovery.push("Upload and parse a résumé, or add its extracted text in My profile.");
  if (!s.profile.name || !emailValid(s.profile.email || "") || sampleEmail(s.profile.email)) discovery.push("Save your real name and email in My profile.");
  if(!policy.freeContactFallback && !s.contacts.some(c=>!c.isDemo && !c.suppressed && c.emailStatus==='verified')) {
    if (!policy.allowContactCredits) contacts.push("Allow contact API usage or enable the public-contact fallback.");
    if (!config.APOLLO_API_KEY && !config.HUNTER_API_KEY) contacts.push("Add an Apollo or Hunter API key, or enable the public-contact fallback.");
  }
  if (config.ENABLE_LIVE_SEND !== "true") sending.push("Live sending is disabled on the server.");
  if (policy.accountId) {
    if (!await store.db.prepare("SELECT id FROM mail_accounts WHERE id=?").get(policy.accountId)) sending.push("Connect the selected sending mailbox.");
  } else if (!config.RESEND_API_KEY || !config.EMAIL_FROM) sending.push("Connect a mailbox or configure a verified Resend sender.");
  if (policy.followup && !policy.accountId) sending.push("Follow-ups require a connected mailbox with reply detection.");
  if (policy.useAI && (!config.LLM_API_KEY || !config.LLM_MODEL)) contacts.push("Configure an AI model or turn off AI drafting to use factual templates.");
  return { discovery, contacts, sending };
}
export async function savePolicy(data, store, config) {
  const current = await getPolicy(store), p = { ...AUTOPILOT_DEFAULTS };
  const number = (key, min, max) => {
    const n = Number(data[key] ?? current[key]);
    if (!Number.isInteger(n) || n < min || n > max) fail(`${key} must be a whole number between ${min} and ${max}.`);
    return n;
  };
  for (const key of ["enabled", "allowContactCredits", "useAI", "useSearchAPI", "followup","freeContactFallback"]) p[key] = (data[key] ?? current[key]) === true;
  p.minimumMatchScore = number("minimumMatchScore", 75, 100);
  p.dailySendLimit = number("dailySendLimit", 1, 50);
  p.contactsPerCompany = number("contactsPerCompany", 1, 3);
  p.maxContactLookupsPerDay = number("maxContactLookupsPerDay", 1, 100);
  p.minDelayMinutes=number('minDelayMinutes',3,60);p.maxDelayMinutes=number('maxDelayMinutes',p.minDelayMinutes,120);
  p.approvalMode = data.approvalMode ?? current.approvalMode;
  p.resumeMode = data.resumeMode ?? current.resumeMode;
  if (!["review", "automatic"].includes(p.approvalMode)) fail("Choose review or automatic approval mode.");
  if (!["link", "attachment"].includes(p.resumeMode)) fail("Choose a résumé link or attachment.");
  p.accountId = String(data.accountId ?? current.accountId).slice(0, 100);
  p.timeZone = String(data.timeZone ?? current.timeZone).slice(0, 80);
  p.country = String(data.country ?? current.country).toUpperCase();
  if(p.country && !/^[A-Z]{2}$/.test(p.country)) fail("Use a two-letter country code such as IN, GB, or US.");
  try { new Intl.DateTimeFormat("en-US", { timeZone: p.timeZone }); } catch { fail("Choose a valid IANA time zone."); }
  if (p.enabled) {
    const blockers = await pipelineBlockers(store, config, p);
    if (blockers.discovery.length) fail(blockers.discovery[0]);
    if (p.approvalMode === "automatic" && [...blockers.contacts, ...blockers.sending].length) fail([...blockers.contacts, ...blockers.sending][0]);
    if (data.acknowledged !== true) fail("Acknowledge the displayed Autopilot settings before enabling them.");
  }
  p.id = id(); p.updatedAt = now(); p.scope = profileScope(store.state);
  await store.db.prepare("INSERT INTO autopilot_config(id,body) VALUES('local',?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(JSON.stringify(p));
  // Policy changes revoke queued automatic approvals and old review batches.
  await activity(store, "policy", p.enabled ? `Autopilot enabled in ${p.approvalMode === "review" ? "review" : "automatic"} mode.` : "Autopilot paused. Pending automatic sends will stop.");
  return p;
}
export async function policyAllows(store, campaign, automaticOnly = false) {
  if (!campaign.autopilot) return true;
  const p = await getPolicy(store);
  return p.enabled && p.id === campaign.autopilot.policyId && p.scope === profileScope(store.state)
    && (!automaticOnly || p.approvalMode === "automatic");
}
