import { fetchCoreJobs } from "./core.mjs";
import {fetchIndiaATS,INDIA_ATS} from './india-ats.mjs';
import {fetchEnterpriseJobs} from './enterprise-direct.mjs';
import { fetchHimalayas } from "./himalayas.mjs";
import { fetchPublicFeed } from './public-feeds.mjs';
import {fetchGoogleJobs} from './google-jobs.mjs';
import {fetchLinkedInGuest} from './linkedin-guest.mjs';
import {fetchRegional} from './regional.mjs';
import {fetchPublicATS} from './public-ats.mjs';
import {crawlCareerPage} from './career-pages.mjs';
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
  "LinkedIn Guest",
  "India & finance boards",
  'SmartRecruiters','Workable','Recruitee','Lever EU','Workday','The Muse','Career Pages','VC Portfolios',
  ...INDIA_ATS,'Amazon Jobs',
];
export async function fetchJobs(
  source,
  board = "",
  fetcher = fetch,
  config = {},
  query = "",
) {
  if(INDIA_ATS.includes(source))return fetchIndiaATS(source,board,config,fetcher);
  if(source==='Amazon Jobs')return fetchEnterpriseJobs(source,query || board,config,fetcher);
  if(['SmartRecruiters','Workable','Recruitee','Workday'].includes(source))return fetchPublicATS(source,board,config,fetcher,config.SEARCH_QUERY || '');
  if(['Career Pages','VC Portfolios'].includes(source))return (await crawlCareerPage(board,config.CAREER_PAGE_LOADER ? {load:config.CAREER_PAGE_LOADER}:{})).jobs.map(j=>({...j,source,board}));
  if(source==='India & finance boards')return fetchRegional(query || board,config,fetcher);
  if(source==='Google Jobs') return fetchGoogleJobs(query || board,config,fetcher);
  if(source==='LinkedIn Guest') return fetchLinkedInGuest(query || board,config,fetcher);
  if (source === "Himalayas") return fetchHimalayas(query || board, config, fetcher);
  if (["Remote OK","Jobicy","The Muse"].includes(source)) return fetchPublicFeed(source,fetcher,config,query);
  if (["Remotive", "Greenhouse", "Lever",'Lever EU'].includes(source))
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
      publishedAt: j.publishedAt || null,
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
        : null,
    }));
  } else if (source === "Adzuna") {
    if (!config.ADZUNA_APP_ID || !(config.ADZUNA_APP_KEY || config.ADZUNA_API_KEY))
      fail("Configure Adzuna credentials on the server.", 503);
    const country = String(config.SEARCH_COUNTRY || config.ADZUNA_COUNTRY || 'in').toLowerCase();
    if (!/^[a-z]{2}$/.test(country))
      fail("Use a two-letter Adzuna country code.");
    const url = new URL(
      `https://api.adzuna.com/v1/api/jobs/${country}/search/${Math.max(1,Math.min(10,Number(config.ATS_PAGE)||1))}`,
    );
    url.search = new URLSearchParams({
      app_id: config.ADZUNA_APP_ID,
      app_key: config.ADZUNA_APP_KEY || config.ADZUNA_API_KEY,
      what: text(query, 150),
      results_per_page: "50",
      ...(config.SEARCH_LOCATION ? {where:text(config.SEARCH_LOCATION,150)}:{}),
      sort_by:'date',
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
      publishedAt: j.created || null,
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
    if(next.isDemo)continue;
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
