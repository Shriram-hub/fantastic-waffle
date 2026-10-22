import { remoteJSON } from "../http.mjs";
import { text } from "../../domain.mjs";
import {workdayBoard} from './public-ats.mjs';

export function boardFromURL(value) {
  try {
    const u = new URL(value);let slug = u.pathname.split("/").filter(Boolean)[0];
    if(u.protocol!=='https:' || u.username || u.password || u.port)return null;
    const workday=workdayBoard(value);if(workday)return {source:'Workday',slug:workday.url};
    if (/^[\w-]+\.recruitee\.com$/.test(u.hostname))return {source:'Recruitee',slug:u.hostname.split('.')[0]};
    if(u.hostname==='apply.workable.com' && slug==='api')return null;
    if (!/^[\w-]{1,80}$/.test(slug || "")) return null;
    const source = ({"boards.greenhouse.io":"Greenhouse", "job-boards.greenhouse.io":"Greenhouse", "jobs.lever.co":"Lever",'jobs.eu.lever.co':'Lever EU', "jobs.ashbyhq.com":"Ashby",'careers.smartrecruiters.com':'SmartRecruiters','jobs.smartrecruiters.com':'SmartRecruiters','apply.workable.com':'Workable'})[u.hostname];
    return source ? {source, slug} : null;
  } catch { return null; }
}
export function boardURL(board) {
  if(board.source==='Workday' || board.source==='Career Pages')return board.slug;
  const hosts={'Greenhouse':'boards.greenhouse.io','Lever':'jobs.lever.co','Lever EU':'jobs.eu.lever.co','Ashby':'jobs.ashbyhq.com','SmartRecruiters':'careers.smartrecruiters.com','Workable':'apply.workable.com'};
  return board.source==='Recruitee'?`https://${board.slug}.recruitee.com/`:hosts[board.source]?`https://${hosts[board.source]}/${board.slug}`:'';
}
// Optional credentialed discovery, never represented as a zero-key Google API.
export async function discoverATSBoards(role, location, config, fetcher = fetch) {
  if (!config.SERPAPI_API_KEY) return [];
  const url = new URL("https://serpapi.com/search.json");
  url.search = new URLSearchParams({engine:"google",q:`(site:boards.greenhouse.io OR site:job-boards.greenhouse.io OR site:jobs.lever.co OR site:jobs.ashbyhq.com) "${text(role,100)}" ${text(location,100)}`,tbs:"qdr:d",num:"10",api_key:config.SERPAPI_API_KEY});
  const data = await remoteJSON(url.href, {}, fetcher);
  return [...new Map((data.organic_results || []).map(r => boardFromURL(r.link)).filter(Boolean).map(b => [`${b.source}:${b.slug}`, b])).values()];
}
