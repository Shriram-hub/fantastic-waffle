import { remoteJSON } from "../http.mjs";
import { fail, hash, now, safeUrl, stripHtml, text } from "../../domain.mjs";

export async function fetchHimalayas(query, config = {}, fetcher = fetch) {
  const url = new URL("https://himalayas.app/jobs/api/search");
  url.search = new URLSearchParams({ q: text(query, 150), sort: "recent", page: "1" });
  url.searchParams.set('page',String(config.HIMALAYAS_PAGE || 1));
  const data = await remoteJSON(url.href, config.HIMALAYAS_API_KEY ? {headers:{Authorization:`Bearer ${config.HIMALAYAS_API_KEY}`}} : {}, fetcher);
  if (!Array.isArray(data.jobs)) fail("Himalayas returned an unexpected response.", 502);
  return data.jobs.slice(0, 20).filter(j => j.title && safeUrl(j.applicationLink)).map(j => ({
    id: `himalayas-${hash(j.guid || j.applicationLink).slice(0, 32)}`,
    company: text(j.companyName, 150), title: text(j.title, 200),
    location: j.locationRestrictions?.join(", ") || "Remote, worldwide", workMode: "Remote",
    locationRestrictions: j.locationRestrictions || [], timezoneRestrictions: j.timezoneRestrictions || [],
    salary: j.minSalary ? `${j.currency || ""} ${j.minSalary} – ${j.maxSalary || j.minSalary} / ${j.salaryPeriod || "year"}` : "Not listed",
    tags: j.categories || [], category: j.parentCategories?.[0] || "Other", type: j.employmentType || "Not listed",
    // Provider attribution and original link are retained in the private job feed.
    url: safeUrl(j.applicationLink), attribution: "Himalayas", description: text(stripHtml(j.description || j.excerpt), 30000),
    publishedAt: typeof j.pubDate === "number" ? new Date(j.pubDate * 1000).toISOString() : j.pubDate || null,
    expiresAt: j.expiryDate || null, source: "Himalayas", board: text(query, 150), isDemo: false, archived: false, fetchedAt: now(),
  }));
}
