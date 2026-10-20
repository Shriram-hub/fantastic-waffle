import { randomUUID, createHash } from "node:crypto";

export const STAGES = [
  "Saved",
  "Ready",
  "Applied",
  "Interview",
  "Assessment",
  "Interview scheduled",
  "Offer",
  "Rejected",
  "Withdrawn",
];
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const hash = (value) =>
  createHash("sha256")
    .update(JSON.stringify(value ?? null))
    .digest("hex");
export function fail(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  throw e;
}
export const text = (v, max = 2000) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
export const emailValid = (s) =>
  /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s) && !/[\r\n]/.test(s);
export const sampleEmail = (s) =>
  /@(.*\.)?(example\.(com|org|net)|[^@]+\.example|example|invalid|localhost)$/i.test(
    s,
  );
export function safeUrl(value) {
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : "";
  } catch {
    return "";
  }
}
export function stripHtml(v = "") {
  return String(v)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const tokens = (value) => [
  ...new Set(
    String(value)
      .toLowerCase()
      .split(/[^a-z0-9+#.]+/)
      .filter((t) => t.length > 1),
  ),
];
const containsTerm = (value, term) =>
  new RegExp(
    `(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`,
    "i",
  ).test(value);
export function scoreJob(job, profile) {
  const haystack =
    `${job.title} ${job.description} ${(job.tags || []).join(" ")}`.toLowerCase();
  const skills = (profile.skills || []).filter(Boolean);
  const matched = skills.filter((s) => containsTerm(haystack, s));
  const missing = skills.filter((s) => !matched.includes(s));
  const roleTokens = tokens((profile.interests || []).join(" "));
  const roleHits = roleTokens.filter((s) => containsTerm(job.title, s));
  const location =
    profile.location &&
    job.location.toLowerCase().includes(profile.location.toLowerCase());
  const mode =
    profile.workMode &&
    (job.workMode === profile.workMode || profile.workMode === "Any");
  if (!skills.length && !roleTokens.length)
    return {
      score: null,
      matched: [],
      missing: [],
      reasons: ["Add your skills and target roles to see a match score."],
    };
  const score = Math.min(
    100,
    Math.round(
      (skills.length ? (matched.length / skills.length) * 60 : 0) +
        (roleTokens.length ? (roleHits.length / roleTokens.length) * 25 : 0) +
        (location ? 5 : 0) +
        (mode ? 10 : 0),
    ),
  );
  return {
    score,
    matched,
    missing,
    reasons: [
      `${matched.length} of ${skills.length} profile skills found in the listing`,
      `${roleHits.length} of ${roleTokens.length} target-role terms found in the title`,
      location ? "Preferred location matches" : "Location not matched",
      mode ? "Work preference matches" : "Work preference not matched",
    ],
  };
}
export function parseCSV(raw) {
  if (typeof raw !== "string" || raw.length > 2_000_000)
    fail("CSV must be under 2 MB.");
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"') {
      if (quoted && raw[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted || !cell) quoted = !quoted;
      else cell += c;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && raw[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) fail("The CSV has an unclosed quoted field.");
  row.push(cell);
  if (row.some(Boolean)) rows.push(row);
  const headers = (rows.shift() || []).map((x) =>
    x
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_"),
  );
  if(!headers.includes('email')){const alias=headers.findIndex(h=>['email_address','work_email','emailaddress','workemail'].includes(h));if(alias>=0)headers[alias]='email';}
  if (!headers.includes("email"))
    fail(
      "The CSV needs an email column. Use name, email, company, title, email_status.",
    );
  if (rows.length > 500) fail("Import up to 500 contacts at a time.");
  return rows.map((r) =>
    Object.fromEntries(headers.map((k, i) => [k, r[i] || ""])),
  );
}
export function normalizeContact(row, source = "CSV") {
  const email = text(row.email, 254).toLowerCase();
  if (email && !emailValid(email)) fail(`Invalid email: ${email}`);
  return {
    id: id(),
    name:
      text(row.name, 150) ||
      [text(row.first_name || row.firstname, 80), text(row.last_name || row.lastname, 80)]
        .filter(Boolean)
        .join(" ") ||
      "Unnamed contact",
    email,
    company: text(row.company || row.company_name || row.organization, 150),
    title: text(row.title || row.job_title || row.role, 150),
    source,
    emailStatus: row.email_status === "verified" ? "verified" : "unverified",
    suppressed: false,
    isDemo: sampleEmail(email),
    createdAt: now(),
  };
}
export function renderTemplate(value, contact, profile) {
  const vars = {
    first_name: contact.name.split(" ")[0],
    name: contact.name,
    company: contact.company,
    title: contact.title,
    my_name: profile.name || "Your name",
    my_role: profile.headline || (profile.interests || [])[0] || "my next role",
    skills: (profile.skills || []).join(", "),
    portfolio: profile.portfolio || "",
    resume_url: profile.resumeUrl || "",
    icebreaker: contact.icebreaker || "",
    warm_hook:contact.warmOpener || "",
    job_title:contact.jobTitle || '',
    job_url:contact.jobUrl || '',
  };
  const unknown = [...value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)]
    .map((m) => m[1])
    .filter((k) => !(k in vars));
  if (unknown.length) fail(`Unknown template variable: ${unknown[0]}`);
  return value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, k) => vars[k]);
}
export function previewCampaign(campaign, state) {
  if (!campaign.name || !campaign.subject || !campaign.body)
    fail("Add a campaign name, subject, and message first.");
  if (/[\r\n]/.test(campaign.subject)) fail("The subject must be one line.");
  if (!state.profile.name || !emailValid(state.profile.email || ""))
    fail("Save your name and email in My profile first.");
  if (campaign.attachResume && !state.resume)
    fail("Upload a résumé before adding it as an attachment.");
  const recipients = [...new Set(campaign.contactIds)].map((cid) =>
    state.contacts.find((c) => c.id === cid),
  );
  if (!recipients.length || recipients.some((c) => !c))
    fail("Select at least one existing contact.");
  if (recipients.length > 100)
    fail("A prototype campaign supports up to 100 recipients.");
  const seen = new Set();
  const excluded = [];
  const messages = [];
  for (const c of recipients) {
    let reason = c.suppressed
      ? "Suppressed"
      : !emailValid(c.email)
        ? "No usable email"
        : seen.has(c.email.toLowerCase())
          ? "Duplicate email"
          : "";
    if (reason) {
      excluded.push({ id: c.id, name: c.name, reason });
      continue;
    }
    seen.add(c.email.toLowerCase());
    const senderProfile={...state.profile,resumeUrl:campaign.resumeLinks?.[c.id]?.url || state.profile.resumeUrl};
    const subject = renderTemplate(campaign.subject, c, senderProfile);
    if (/[\r\n]/.test(subject))
      fail("A contact contains a newline that cannot be used in a subject.");
    const rendered=renderTemplate(campaign.body,c,senderProfile);
    const link=campaign.resumeLinks?.[c.id]?.url;
    const body = `${rendered}${link && !rendered.includes(link) ? `\n\nMy résumé: ${link}` : ""}\n\n${state.profile.name}\n${state.profile.email}\nTo stop receiving messages from me, reply with “unsubscribe”.`;
    messages.push({
      contactId: c.id,
      to: c.email,
      name: c.name,
      company: c.company,
      subject,
      body,
      isDemo: c.isDemo || sampleEmail(c.email),
      emailStatus: c.emailStatus,
    });
  }
  if (!messages.length)
    fail(
      "No eligible recipients remain. Check email addresses and suppression.",
    );
  return {
    messages,
    excluded,
    attachment: campaign.attachResume
      ? (()=>{const r=state.jobDocuments?.find(d=>d.id===campaign.documentSetId)?.resume || state.resume;return {name:r.name,size:r.size};})()
      : null,
  };
}
export function campaignFingerprint(campaign, state) {
  return hash({
    accountId: campaign.accountId || null,
    sequence: campaign.sequence || null,
    name: campaign.name,
    subject: campaign.subject,
    body: campaign.body,
    contactIds: campaign.contactIds,
    attachResume: campaign.attachResume,
    profile: state.profile,
    resume: state.resume
      ? state.resume.contentHash || hash(state.resume.base64)
      : null,
    contacts: campaign.contactIds.map(cid => {const c=state.contacts.find(c=>c.id===cid);return c && Object.fromEntries(['id','name','email','company','title','emailStatus','suppressed','isDemo','icebreaker','jobTitle','jobUrl','warmSignals','warmOpener'].map(k=>[k,c[k]]));}),
    documentSetId:campaign.documentSetId || null,trackResume:campaign.trackResume || false,attachCoverLetter:campaign.attachCoverLetter || false,resumeLinks:campaign.resumeLinks || null,
    jobId: campaign.jobId || null,
    autopilot: campaign.autopilot || null,
    resumeShare: campaign.resumeShare || null,
  });
}
export function suggestStage(subject, body) {
  const t = `${subject}\n${body}`.toLowerCase();
  if (
    /unfortunately|not (?:be )?(?:moving|proceeding)|other candidates|application.*unsuccessful|regret to inform/.test(
      t,
    )
  )
    return "Rejected";
  if (/offer (?:letter|of employment)|pleased to offer|extend.*offer/.test(t))
    return "Offer";
  if (
    /hackerrank|codesignal|coding (?:test|assessment)|online assessment/.test(t)
  )
    return "Assessment";
  if (
    /interview|schedule.*(?:call|conversation)|technical (?:round|assessment)/.test(
      t,
    )
  )
    return "Interview";
  if (
    /application (?:received|submitted)|received your application|thank you for applying/.test(
      t,
    )
  )
    return "Applied";
  return null;
}
export function applicationPacket(job, profile) {
  return `APPLICATION PREPARATION • ${job.company}\n${job.title}\n${job.url || "Sample listing; no live application link."}\n\nName: ${profile.name || ""}\nEmail: ${profile.email || ""}\nPhone: ${profile.phone || ""}\nLocation: ${profile.location || ""}\nPortfolio: ${profile.portfolio || ""}\nWork authorization: ${profile.authorization || "Confirm for this position"}\nSkills: ${(profile.skills || []).join(", ")}\n\nCOVER NOTE DRAFT\nHello ${job.company} team,\n\nI would like to apply for the ${job.title} position. My background includes ${(profile.skills || []).slice(0, 5).join(", ") || "[add your relevant skills]"}. ${profile.summary || "[Add a relevant project or achievement here.]"}\n\nI would welcome a conversation about how I could contribute to your team.\n\n${profile.name || "[Your name]"}\n\nReview all details and attach your résumé on the employer website. This packet does not submit an application.\n`;
}
