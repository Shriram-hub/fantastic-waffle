import { id, now, suggestStage, safeUrl } from "../domain.mjs";
const address = (from) =>
  from.match(/<?([^\s<>]+@[^\s<>]+)>?/)?.[1]?.toLowerCase() || "";
const clean = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export function shouldClassify(message, state) {
  const sender = address(message.from),
    domain = sender.split("@")[1] || "",
    content = clean(`${message.subject} ${message.body}`),
    hasSubject =
      /application|interview|assessment|next steps|offer|update|rejected/i.test(
        message.subject,
      );
  const ats =
    /(^|\.)(greenhouse\.io|hire\.lever\.co|myworkday\.com|ashbyhq\.com)$/.test(
      domain,
    );
  return Boolean(
    (ats && hasSubject) ||
      state.applications.some((a) => {
        const j = state.jobs.find((j) => j.id === a.jobId);
        return (
          j &&
          ((content.includes(clean(j.company)) &&
            content.includes(clean(j.title))) ||
            (j.companyDomain === domain && hasSubject))
        );
      }),
  );
}
export function classifyEmail(message, state) {
  const body = message.body.split(/\nOn .+wrote:|\n_{5,}|\nFrom:/i)[0],
    combined = `${message.subject}\n${body}`;
  const assessment =
    /hackerrank|codesignal|coding (?:test|assessment)|online assessment/i.test(
      combined,
    );
  const proposedStage = message.aiClassification
    ? message.aiClassification.confidence >= 0.9 &&
      message.aiClassification.stage !== "Unknown"
      ? message.aiClassification.stage
      : null
    : suggestStage(message.subject, body);
  const links = [...combined.matchAll(/https?:\/\/[^\s<>"')]+/gi)]
    .map((m) => safeUrl(m[0]))
    .filter(Boolean);
  const deadline =
    combined.match(
      /(?:deadline|due(?:\s+by)?)\s*:?\s*(\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d\d:\d\d)?)?)/i,
    )?.[1] || null;
  const sender = address(message.from),
    knownATS =
      /(?:greenhouse\.io|hire\.lever\.co|myworkday\.com|ashbyhq\.com)$/.test(
        sender.split("@")[1] || "",
      );
  const candidates = state.applications.filter((a) => {
    const j = state.jobs.find((j) => j.id === a.jobId);
    if (!j) return false;
    const title = clean(j.title),
      company = clean(j.company),
      hay = clean(combined);
    return (
      title.length >= 4 &&
      hay.includes(title) &&
      (hay.includes(company) ||
        knownATS ||
        Boolean(j.companyDomain && sender.endsWith(`@${j.companyDomain}`)))
    );
  });
  return {
    proposedStage,
    applicationId: candidates.length === 1 ? candidates[0].id : null,
    ambiguous: candidates.length > 1,
    candidates: candidates.map((a) => a.id),
    sender,
    deadline,
    links,
    body,
  };
}
const ranks = {
  Saved: 0,
  Ready: 1,
  Applied: 2,
  Assessment: 3,
  Interview: 4,
  "Interview scheduled": 5,
  Offer: 6,
};
export function ingestMessage(message, store) {
  const s = store.state;
  if (message.outbound) return { ignored: true };
  // Replies stop outreach even if the email is not a job-status update.
  for (const c of s.campaigns)
    for (const d of c.deliveries || []) {
      const recipient = s.contacts.find((x) => x.id === d.contactId);
      if (
        recipient?.email?.toLowerCase() === address(message.from) &&
        (!d.threadId || message.threadId === d.threadId)
      ) {
        d.repliedAt = message.receivedAt;
        d.followupStopped = true;
      }
    }
  if (s.inbox.some((x) => x.messageId === message.id)) {
    store.save();
    return { duplicate: true };
  }
  if (!shouldClassify(message, s)) {
    store.save();
    return { ignored: true };
  }
  const result = classifyEmail(message, s);
  if (!result.proposedStage && !result.deadline) {
    store.save();
    return { ignored: true };
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
    candidateIds: result.candidates,
  };
  if (
    s.settings.inboxAutoUpdate &&
    result.applicationId &&
    result.proposedStage
  ) {
    const a = s.applications.find((a) => a.id === result.applicationId);
    const oldTime = a.lastEmailAt ? Date.parse(a.lastEmailAt) : 0;
    const timely = Date.parse(message.receivedAt) >= oldTime;
    const terminal = ["Offer", "Rejected", "Withdrawn"].includes(a.stage);
    const forward =
      result.proposedStage === "Rejected" ||
      (ranks[result.proposedStage] ?? -1) >= (ranks[a.stage] ?? 0);
    if (timely && !terminal && forward) {
      a.stage = result.proposedStage;
      a.updatedAt = now();
      a.lastEmailAt = message.receivedAt;
      a.history.push({
        stage: a.stage,
        at: now(),
        source: `Mailbox sync: ${message.subject}`,
      });
      item.status = "Auto-applied";
    }
  }
  s.inbox.unshift(item);
  store.save();
  return { item };
}
