import { remoteJSON } from "../http.mjs";
import { text } from "../../domain.mjs";

export function boardFromURL(value) {
  try {
    const u = new URL(value), slug = u.pathname.split("/").filter(Boolean)[0];
    if (u.protocol !== "https:" || !/^[\w-]{1,80}$/.test(slug || "")) return null;
    const source = ({"boards.greenhouse.io":"Greenhouse", "job-boards.greenhouse.io":"Greenhouse", "jobs.lever.co":"Lever", "jobs.ashbyhq.com":"Ashby"})[u.hostname];
    return source ? {source, slug} : null;
  } catch { return null; }
}
// Optional credentialed discovery, never represented as a zero-key Google API.
export async function discoverATSBoards(role, location, config, fetcher = fetch) {
  if (!config.SERPAPI_API_KEY) return [];
  const url = new URL("https://serpapi.com/search.json");
  url.search = new URLSearchParams({engine:"google",q:`(site:boards.greenhouse.io OR site:job-boards.greenhouse.io OR site:jobs.lever.co OR site:jobs.ashbyhq.com) "${text(role,100)}" ${text(location,100)}`,tbs:"qdr:d",num:"10",api_key:config.SERPAPI_API_KEY});
  const data = await remoteJSON(url.href, {}, fetcher);
  return [...new Map((data.organic_results || []).map(r => boardFromURL(r.link)).filter(Boolean).map(b => [`${b.source}:${b.slug}`, b])).values()];
}
