import {
  fail,
  id,
  now,
  safeUrl,
  stripHtml,
  text,
  emailValid,
} from "../../domain.mjs";
import { remoteJSON } from "../http.mjs";
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
export async function fetchCoreJobs(source, board = "", fetcher = fetch) {
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
      companyLogo:safeUrl(j.company_logo),
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
