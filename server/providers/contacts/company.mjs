import { remoteJSON } from "../http.mjs";
import { text } from "../../domain.mjs";
import boards from "../jobs/boards.json" with { type: "json" };

const normalize = s => String(s || "").normalize("NFKC").toLowerCase().replace(/\b(incorporated|inc|llc|ltd|limited|corporation)\b/g, "").replace(/[^a-z0-9]/g, "");
export function companyDomain(value) {
  const domain = String(value || "").trim().toLowerCase().replace(/^www\./, "");
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) return "";
  if (/(^|\.)(gmail\.com|outlook\.com|yahoo\.com|hotmail\.com|greenhouse\.io|lever\.co|ashbyhq\.com|workday\.com|myworkdayjobs\.com|linkedin\.com|indeed\.com|glassdoor\.com|himalayas\.app|arbeitnow\.com|remotive\.com|remoteok\.com|jobicy\.com|example\.com|localhost)$/.test(domain)) return "";
  return domain;
}
export async function resolveCompany(job, fetcher = fetch, store) {
  if(store) {
    const matches=(await store.db.prepare('SELECT body FROM companies WHERE name=?').all(job.company)).map(r=>JSON.parse(r.body)).filter(c=>companyDomain(c.domain));
    if(new Set(matches.map(c=>c.domain)).size===1) return matches[0];
  }
  const known = boards.find(b => b.source === job.source && b.slug === job.board)
    || boards.find(b => normalize(b.company) === normalize(job.company));
  if (known && companyDomain(known.companyDomain)) return {domain:known.companyDomain,name:job.company,source:"Curated company board",reference:known.reference};
  if (job.companyDomain && job.companyDomainSource === "provider" && companyDomain(job.companyDomain)) return {domain:companyDomain(job.companyDomain),name:job.company,source:"Job provider company website"};
  const url = new URL("https://autocomplete.clearbit.com/v1/companies/suggest");
  url.searchParams.set("query", text(job.company,150));
  let data;
  try {data=await remoteJSON(url.href, {}, fetcher);} catch {data=[];}
  if (!Array.isArray(data)) return null;
  const exact = data.filter(c => normalize(c.name) === normalize(job.company) && companyDomain(c.domain));
  const domains = [...new Set(exact.map(c => companyDomain(c.domain)))];
  // Never choose a fuzzy first result for ambiguous company names.
  if(domains.length===1) return {domain:domains[0],name:job.company,source:"Clearbit exact-name autocomplete",reference:url.href};
  if(domains.length>1) return null;
  // A non-ATS URL is only a hint when its hostname actually matches the company.
  try {
    const link=new URL(job.url),domain=companyDomain(link.hostname),name=normalize(job.company);
    if(link.protocol==='https:' && domain && name.length>=4 && normalize(domain.split('.').slice(0,-1).join('')).includes(name)) return {domain,name:job.company,source:'Matching company application URL',reference:link.href};
  } catch {}
  return null;
}
