import { fetchCoreJobs } from "./core.mjs";
import { fetchHimalayas } from "./himalayas.mjs";
import { fetchPublicFeed } from './public-feeds.mjs';
import {fetchGoogleJobs} from './google-jobs.mjs';
import { remoteJSON } from "../http.mjs";
import { fail, hash, now, safeUrl, stripHtml, text } from "../../domain.mjs";
export const JOB_SOURCES = [
  "Remotive",
  "Greenhouse",
  "Lever",
  "Ashby",
  "Arbeitnow",
  "Adzuna",
  "Himalayas",
  "Remote OK", "Jobicy",
  "Google Jobs",
];
export async function fetchJobs(
  source,
  board = "",
  fetcher = fetch,
  config = {},
  query = "",
) {
  if(source==='Google Jobs') return fetchGoogleJobs(query || board,config,fetcher);
  if (source === "Himalayas") return fetchHimalayas(query || board, config, fetcher);
  if (["Remote OK","Jobicy"].includes(source)) return fetchPublicFeed(source,fetcher);
  if (["Remotive", "Greenhouse", "Lever"].includes(source))
    return fetchCoreJobs(source, board, fetcher);
  let jobs = [];
  if (source === "Ashby") {
    if (!/^[\w-]{1,80}$/.test(board)) fail("Enter a valid Ashby board slug.");
    const data = await remoteJSON(
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`,
      {},
      fetcher,
    );
    if (!Array.isArray(data.jobs))
      fail("Ashby returned an unexpected response.", 502);
    jobs = data.jobs.map((j) => ({
      id: `ashby-${board}-${j.id}`,
      company: board,
      title: j.title,
      location: j.location || "Not listed",
      workMode: j.isRemote
        ? "Remote"
        : /hybrid/i.test(j.workplaceType || "")
          ? "Hybrid"
          : "On-site",
      salary: j.compensation?.compensationTierSummary || "Not listed",
      tags: [j.department, j.team].filter(Boolean),
      category: j.department || "Other",
      type: j.employmentType || "Not listed",
      url: safeUrl(j.applyUrl || j.jobUrl),
      description: stripHtml(j.descriptionPlain || j.descriptionHtml),
      publishedAt: j.publishedAt || now(),
    }));
  } else if (source === "Arbeitnow") {
    const data = await remoteJSON(
      "https://www.arbeitnow.com/api/job-board-api",
      {},
      fetcher,
    );
    if (!Array.isArray(data.data))
      fail("Arbeitnow returned an unexpected response.", 502);
    jobs = data.data.map((j) => ({
      id: `arbeitnow-${j.slug}`,
      company: j.company_name,
      title: j.title,
      location: j.location || "Not listed",
      workMode: j.remote ? "Remote" : "On-site",
      salary: "Not listed",
      tags: j.tags || [],
      category: "Other",
      type: (j.job_types || []).join(", ") || "Not listed",
      url: safeUrl(j.url),
      description: stripHtml(j.description),
      publishedAt: j.created_at
        ? new Date(j.created_at * 1000).toISOString()
        : now(),
    }));
  } else if (source === "Adzuna") {
    if (!config.ADZUNA_APP_ID || !config.ADZUNA_APP_KEY)
      fail("Configure Adzuna credentials on the server.", 503);
    const country = config.ADZUNA_COUNTRY || "in";
    if (!/^[a-z]{2}$/.test(country))
      fail("Use a two-letter Adzuna country code.");
    const url = new URL(
      `https://api.adzuna.com/v1/api/jobs/${country}/search/1`,
    );
    url.search = new URLSearchParams({
      app_id: config.ADZUNA_APP_ID,
      app_key: config.ADZUNA_APP_KEY,
      what: text(query, 150),
      results_per_page: "50",
    });
    const data = await remoteJSON(url.href, {}, fetcher);
    if (!Array.isArray(data.results))
      fail("Adzuna returned an unexpected response.", 502);
    jobs = data.results.map((j) => ({
      id: `adzuna-${country}-${j.id}`,
      company: j.company?.display_name || "Not listed",
      title: j.title,
      location: j.location?.display_name || "Not listed",
      workMode: /remote/i.test(j.title + " " + j.description)
        ? "Remote"
        : "On-site",
      salary: j.salary_min
        ? `${j.salary_min} – ${j.salary_max || j.salary_min} (provider range)`
        : "Not listed",
      tags: [j.category?.label].filter(Boolean),
      category: j.category?.label || "Other",
      type: j.contract_time || "Not listed",
      url: safeUrl(j.redirect_url),
      description: stripHtml(j.description),
      publishedAt: j.created || now(),
    }));
  } else fail("Unsupported job source.");
  return jobs
    .filter((j) => j.title && j.url)
    .slice(0, 1000)
    .map((j) => ({
      ...j,
      company: text(j.company, 150),
      title: text(j.title, 200),
      description: text(j.description, 30000),
      source,
      board,
      isDemo: false,
      archived: false,
      fetchedAt: now(),
    }));
}
const normalized = (s) =>
  String(s)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export const canonicalJobKey = (j) =>
  hash([normalized(j.company), normalized(j.title), normalized(j.location)]);
export function mergeJobListings(existing, incoming, source, board = "") {
  const result = structuredClone(existing),
    map = new Map(
      result.filter((j) => !j.isDemo).map((j) => [canonicalJobKey(j), j]),
    );
  for (const j of result.filter((j) => !j.isDemo)) {
    j.sources ||= [
      {
        id: j.id,
        source: j.source,
        board: j.board || "",
        url: j.url,
        active: !j.archived,
      },
    ];
    for (const origin of j.sources)
      if (origin.source === source && origin.board === board)
        origin.active = false;
  }
  for (const next of incoming) {
    const key = canonicalJobKey(next),
      old = map.get(key),
      origin = { id: next.id, source, board, url: next.url, active: true };
    if (old) {
      const found = old.sources.find((s) => s.id === next.id);
      if (found) Object.assign(found, origin);
      else old.sources.push(origin);
      old.archived = false;
      old.fetchedAt = next.fetchedAt;
      if (old.description.length < next.description.length)
        old.description = next.description;
    } else {
      const job = { ...next, canonicalKey: key, sources: [origin] };
      result.push(job);
      map.set(key, job);
    }
  }
  for (const j of result.filter((j) => !j.isDemo))
    j.archived = !j.sources.some((s) => s.active);
  return result;
}
