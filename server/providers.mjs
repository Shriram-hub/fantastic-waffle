import {
  fail,
  id,
  now,
  safeUrl,
  stripHtml,
  text,
  emailValid,
} from "./domain.mjs";

export async function remoteJSON(url, options = {}, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(url, {
      ...options,
      signal: AbortSignal.timeout(15000),
      redirect: "error",
      headers: { Accept: "application/json", ...options.headers },
    });
  } catch {
    fail(
      "The provider could not be reached. Check connectivity and try again later.",
      502,
    );
  }
  if (!response.ok)
    fail(
      `The provider returned HTTP ${response.status}. Check its API access, rate limits, and configuration.`,
      502,
    );
  const reader = response.body?.getReader();
  if (!reader) return response.json();
  const parts = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > 12_000_000) {
      await reader.cancel();
      fail("The provider response exceeded the 12 MB limit.", 502);
    }
    parts.push(part.value);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    fail("The provider returned invalid JSON.", 502);
  }
}
const mode = (s) =>
  /remote/i.test(s) ? "Remote" : /hybrid/i.test(s) ? "Hybrid" : "On-site";
const slugValid = (s) => /^[a-zA-Z0-9_-]{1,80}$/.test(s);
export function boardList(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(",");
  const unique = [...new Set(list.map((s) => text(s, 80)).filter(Boolean))];
  if (unique.length > 10 || unique.some((s) => !slugValid(s)))
    fail(
      "Use up to 10 job-board slugs per provider (letters, numbers, hyphens, underscores).",
    );
  return unique;
}
export async function fetchJobs(source, board = "", fetcher = fetch) {
  if (!["Remotive", "Greenhouse", "Lever"].includes(source))
    fail("Unsupported job source.");
  if (source !== "Remotive" && !slugValid(board))
    fail("Enter a valid company job-board slug.");
  let jobs = [];
  if (source === "Remotive") {
    const data = await remoteJSON(
      "https://remotive.com/api/remote-jobs",
      {},
      fetcher,
    );
    if (!Array.isArray(data.jobs))
      fail("Remotive returned an unexpected response.", 502);
    jobs = data.jobs.map((j) => ({
      id: `remotive-${j.id}`,
      company: j.company_name,
      title: j.title,
      location: j.candidate_required_location || "Remote",
      workMode: "Remote",
      salary: j.salary || "Not listed",
      tags: j.tags || [],
      category: j.category || "Other",
      type: j.job_type?.replaceAll("_", " ") || "Not listed",
      url: safeUrl(j.url),
      description: stripHtml(j.description),
      publishedAt: j.publication_date || now(),
    }));
  }
  if (source === "Greenhouse") {
    const data = await remoteJSON(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`,
      {},
      fetcher,
    );
    if (!Array.isArray(data.jobs))
      fail("Greenhouse returned an unexpected response.", 502);
    jobs = data.jobs.map((j) => ({
      id: `greenhouse-${board}-${j.id}`,
      company: board,
      title: j.title,
      location: j.location?.name || "Not listed",
      workMode: mode(j.location?.name || ""),
      salary: "Not listed",
      tags: (j.departments || []).map((d) => d.name),
      category: j.departments?.[0]?.name || "Other",
      type: "Not listed",
      url: safeUrl(j.absolute_url),
      description: stripHtml(j.content),
      publishedAt: j.updated_at || now(),
    }));
  }
  if (source === "Lever") {
    const data = await remoteJSON(
      `https://api.lever.co/v0/postings/${encodeURIComponent(board)}?mode=json`,
      {},
      fetcher,
    );
    if (!Array.isArray(data))
      fail("Lever returned an unexpected response.", 502);
    jobs = data.map((j) => ({
      id: `lever-${board}-${j.id}`,
      company: board,
      title: j.text,
      location: j.categories?.location || "Not listed",
      workMode: mode(
        `${j.workplaceType || ""} ${j.categories?.location || ""}`,
      ),
      salary: j.salaryRange
        ? `${j.salaryRange.currency || ""} ${j.salaryRange.min || ""} – ${j.salaryRange.max || ""} / ${j.salaryRange.interval || ""}`
        : "Not listed",
      tags: [j.categories?.team, j.categories?.department].filter(Boolean),
      category: j.categories?.team || "Other",
      type: j.categories?.commitment || "Not listed",
      url: safeUrl(j.applyUrl || j.hostedUrl),
      description: stripHtml(
        [
          j.descriptionPlain || j.description,
          ...(j.lists || []).map((l) => `${l.text} ${l.content}`),
        ].join(" "),
      ),
      publishedAt: j.createdAt ? new Date(j.createdAt).toISOString() : now(),
    }));
  }
  return jobs
    .filter((j) => j.title && j.url)
    .slice(0, 1000)
    .map((j) => ({
      ...j,
      company: text(j.company, 150),
      title: text(j.title, 200),
      location: text(j.location, 250),
      description: text(j.description, 30000),
      source,
      board,
      isDemo: false,
      archived: false,
      fetchedAt: now(),
    }));
}
export async function searchApollo(query, key, fetcher = fetch) {
  if (!key) fail("Set APOLLO_API_KEY on the server to search Apollo.", 503);
  const domain = text(query.domain, 200).toLowerCase();
  if (
    domain &&
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)
  )
    fail("Enter a company domain such as example.com, without https://.");
  const titles = text(query.titles, 300)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);
  if (!domain && !titles.length)
    fail("Enter a company domain or a target job title.");
  const data = await remoteJSON(
    "https://api.apollo.io/api/v1/mixed_people/api_search",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": key },
      body: JSON.stringify({
        page: 1,
        per_page: 25,
        ...(domain ? { q_organization_domains_list: [domain] } : {}),
        ...(titles.length ? { person_titles: titles } : {}),
      }),
    },
    fetcher,
  );
  if (!Array.isArray(data.people))
    fail("Apollo returned an unexpected response.", 502);
  return data.people
    .map((p) => ({
      id: id(),
      apolloId: String(p.id || p.person_id || ""),
      name:
        text(
          [p.first_name, p.last_name || p.last_name_obfuscated]
            .filter(Boolean)
            .join(" "),
          150,
        ) || "Apollo contact",
      company: text(p.organization?.name || p.organization_name, 150),
      title: text(p.title, 150),
      email: "",
      emailStatus: "unverified",
      source: "Apollo",
      isDemo: false,
      suppressed: false,
      createdAt: now(),
    }))
    .filter((p) => p.apolloId);
}
export async function enrichApollo(contact, key, fetcher = fetch) {
  if (!key) fail("Set APOLLO_API_KEY on the server first.", 503);
  if (!contact.apolloId || contact.source !== "Apollo")
    fail("Select a contact found through Apollo search.");
  const data = await remoteJSON(
    "https://api.apollo.io/api/v1/people/match",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": key },
      body: JSON.stringify({
        id: contact.apolloId,
        reveal_personal_emails: false,
        reveal_phone_number: false,
      }),
    },
    fetcher,
  );
  if (!data.person) fail("Apollo did not find a matching person.", 404);
  const p = data.person;
  return {
    name: text(p.name, 150) || contact.name,
    email: emailValid(p.email || "") ? p.email.toLowerCase() : "",
    emailStatus: p.email_status === "verified" ? "verified" : "unverified",
    title: text(p.title, 150) || contact.title,
    company: text(p.organization?.name, 150) || contact.company,
    enrichedAt: now(),
  };
}
export async function sendResend(
  message,
  config,
  attachment,
  key,
  fetcher = fetch,
) {
  let response;
  try {
    response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${config.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify({
        from: config.EMAIL_FROM,
        to: [message.to],
        reply_to: message.replyTo,
        subject: message.subject,
        text: message.body,
        ...(attachment
          ? {
              attachments: [
                { filename: attachment.name, content: attachment.base64 },
              ],
            }
          : {}),
      }),
    });
  } catch {
    return {
      status: "unknown",
      error:
        "Provider acceptance is unknown after a network failure. Reconcile in Resend before retrying.",
    };
  }
  let data;
  try {
    data = await response.json();
  } catch {
    return {
      status: "unknown",
      error: "Provider response unreadable. Reconcile in Resend.",
    };
  }
  if (!response.ok)
    return {
      status: response.status >= 500 ? "unknown" : "failed",
      error: `Provider returned HTTP ${response.status}. ${response.status >= 500 ? "Reconcile in Resend before retrying." : "Check provider configuration and limits."}`,
    };
  if (!data.id)
    return {
      status: "unknown",
      error: "No provider message ID. Reconcile in Resend.",
    };
  return { status: "accepted", providerId: data.id, at: now() };
}
