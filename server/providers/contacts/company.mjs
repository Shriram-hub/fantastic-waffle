import { remoteJSON } from "../http.mjs";
import { text } from "../../domain.mjs";
import boards from "../jobs/boards.json" with { type: "json" };

const normalize = s => String(s || "").normalize("NFKC").toLowerCase().replace(/\b(incorporated|inc|llc|ltd|limited|corporation)\b/g, "").replace(/[^a-z0-9]/g, "");
export function companyDomain(value) {
  const domain = String(value || "").trim().toLowerCase().replace(/^www\./, "");
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) return "";
  if (/(^|\.)(gmail\.com|outlook\.com|yahoo\.com|hotmail\.com|greenhouse\.io|lever\.co|ashbyhq\.com|workday\.com|myworkdayjobs\.com|example\.com|localhost)$/.test(domain)) return "";
  return domain;
}
export async function resolveCompany(job, fetcher = fetch) {
  const known = boards.find(b => b.source === job.source && b.slug === job.board)
    || boards.find(b => normalize(b.company) === normalize(job.company));
  if (known && companyDomain(known.companyDomain)) return {domain:known.companyDomain,name:job.company,source:"Curated company board",reference:known.reference};
  if (job.companyDomain && job.companyDomainSource === "provider" && companyDomain(job.companyDomain)) return {domain:companyDomain(job.companyDomain),name:job.company,source:"Job provider company website"};
  const url = new URL("https://autocomplete.clearbit.com/v1/companies/suggest");
  url.searchParams.set("query", text(job.company,150));
  const data = await remoteJSON(url.href, {}, fetcher);
  if (!Array.isArray(data)) return null;
  const exact = data.filter(c => normalize(c.name) === normalize(job.company) && companyDomain(c.domain));
  const domains = [...new Set(exact.map(c => companyDomain(c.domain)))];
  // Never choose a fuzzy first result for ambiguous company names.
  return domains.length === 1 ? {domain:domains[0],name:job.company,source:"Clearbit exact-name autocomplete",reference:url.href} : null;
}
