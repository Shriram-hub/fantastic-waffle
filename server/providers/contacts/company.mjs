import { remoteJSON } from "../http.mjs";
import { text } from "../../domain.mjs";
import boards from "../jobs/boards.json" with { type: "json" };
import {dohRecords} from './dns.mjs';

const normalize = s => String(s || "").normalize("NFKC").toLowerCase().replace(/\b(incorporated|inc|llc|ltd|limited|corporation)\b/g, "").replace(/[^a-z0-9]/g, "");
export function cleanCompanyName(value,{brand=false}={}) {
  const base=text(value,200).normalize('NFKC').replace(/\([^)]*\)/g,' ').split(/\s[-–|]\s|,/)[0].replace(/\b(pvt|private|ltd|limited|inc|incorporated|corp|corporation|llc|llp|plc|india|international|co|company|branch|offshore)\b\.?/gi,' ').replace(/&\s*$/,'').replace(/\s+/g,' ').trim();
  const core=brand ? base.replace(/\b(global|technologies|technology|solutions|services|consulting|advisory|group|holdings|bank)\b/gi,' ').replace(/\s+/g,' ').trim() : base;
  return core || base || text(value,100).split(/\s+/)[0];
}
const aliases=[
  {names:['Deloitte','Deloitte India'],domain:'deloitte.com',reference:'https://www.deloitte.com/'},
  {names:['HDFC Bank'],domain:'hdfcbank.com',reference:'https://www.hdfc.bank.in/contact-us'},
  {names:['JPMorgan Chase','JPMorgan Chase & Co.'],domain:'jpmorganchase.com',reference:'https://www.jpmorganchase.com/'},
  {names:['EY','EY-Parthenon'],domain:'ey.com',reference:'https://www.ey.com/'},
  {names:['BDO India'],domain:'bdo.in',reference:'https://www.bdo.in/'},
  {names:['Goldman Sachs'],domain:'goldmansachs.com',reference:'https://www.goldmansachs.com/'},
  {names:['State Street','State Street Bank'],domain:'statestreet.com',reference:'https://www.statestreet.com/'},
  {names:['Wells Fargo','Wells Fargo Foundation','The Wells Fargo Foundation'],domain:'wellsfargo.com',reference:'https://www.wellsfargo.com/about/responsibility-and-impact/community-giving/'},
  {names:['ESAF Small Finance Bank'],domain:'esafbank.com',reference:'https://www.esafbank.com/'}
];
export function companyDomain(value) {
  const domain = String(value || "").trim().toLowerCase().replace(/^www\./, "");
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) return "";
  if (/(^|\.)(gmail\.com|outlook\.com|yahoo\.com|hotmail\.com|greenhouse\.io|lever\.co|ashbyhq\.com|workday\.com|myworkdayjobs\.com|myworkdaysite\.com|linkedin\.com|indeed\.com|glassdoor\.com|naukri\.com|iimjobs\.com|instahyre\.com|wellfound\.com|internshala\.com|efinancialcareers\.[a-z.]+|smartrecruiters\.com|icims\.com|taleo\.net|himalayas\.app|arbeitnow\.com|remotive\.com|remoteok\.com|jobicy\.com|example\.(com|org|net)|localhost)$/.test(domain)) return "";
  return domain;
}
export async function resolveCompany(job, fetcher = fetch, store) {
  const cleaned=cleanCompanyName(job.company),key=normalize(cleaned);
  const alias=aliases.find(a=>a.names.some(n=>normalize(cleanCompanyName(n))===key));
  if(store) {
    const matches=(await store.db.prepare('SELECT body FROM companies WHERE name=? OR name=?').all(job.company,cleaned)).map(r=>JSON.parse(r.body)).filter(c=>companyDomain(c.domain) && !c.requiresDomainReview && (!alias || c.domain===alias.domain || c.source==='User-confirmed corporate website') && (!c.resolvedAt || Date.now()-Date.parse(c.resolvedAt)<30*86400000));
    if(new Set(matches.map(c=>c.domain)).size===1) return matches[0];
  }
  if(alias)return {domain:alias.domain,name:job.company,source:'Curated corporate website',reference:alias.reference,resolvedAt:new Date().toISOString()};
  const known = boards.find(b => b.source === job.source && b.slug === job.board)
    || boards.find(b => normalize(b.company) === normalize(job.company));
  if (known && companyDomain(known.companyDomain)) return {domain:known.companyDomain,name:job.company,source:"Curated company board",reference:known.reference};
  if (job.companyDomain && job.companyDomainSource === "provider" && companyDomain(job.companyDomain)) return {domain:companyDomain(job.companyDomain),name:job.company,source:"Job provider company website"};
  for(const value of [job.companyUrl,job.applyUrl,job.url])try {
    const link=new URL(value),domain=companyDomain(link.hostname);
    const hostBrand=normalize(domain.split('.')[0]),brand=normalize(cleanCompanyName(cleaned,{brand:true}));
    if(link.protocol==='https:' && domain && !link.username && !link.password && (value===job.companyUrl || brand.length>=4 && hostBrand.includes(brand)))return {domain,name:job.company,source:'Company website from job listing',reference:link.href,resolvedAt:new Date().toISOString()};
  }catch{}
  const url = new URL("https://autocomplete.clearbit.com/v1/companies/suggest");
  url.searchParams.set("query", cleaned);
  let data;
  try {data=await remoteJSON(url.href, {}, fetcher,4000);} catch {data=[];}
  if (!Array.isArray(data)) data=[];
  const exact = data.filter(c => normalize(cleanCompanyName(c.name)) === key && companyDomain(c.domain));
  const domains = [...new Set(exact.map(c => companyDomain(c.domain)))];
  // Never choose a fuzzy first result for ambiguous company names.
  if(domains.length===1) return {domain:domains[0],name:job.company,source:"Clearbit exact-name autocomplete",reference:url.href};
  if(domains.length>1) return null;
  // A live guessed domain is a lead, not identity proof. Keep it reviewable and
  // block autonomous outreach until the owner confirms the corporate website.
  const slug=normalize(cleanCompanyName(cleaned,{brand:true}));
  if(slug.length>=4 && slug.length<=50)for(const suffix of ['com','in','co.in','io','co','org']) {
    const candidate=companyDomain(`${slug}.${suffix}`);if(!candidate)continue;
    try {const mx=await dohRecords(candidate,'MX',fetcher);if(mx.records.some(r=>r.exchange && r.exchange!=='.'))return {domain:candidate,name:job.company,source:'DNS domain suggestion',requiresDomainReview:true,reference:`https://${candidate}`,resolvedAt:new Date().toISOString()};}catch{}
  }
  return null;
}
