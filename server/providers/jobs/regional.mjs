import {remoteJSON} from '../http.mjs';
import {fail,hash,now,safeUrl,text,stripHtml} from '../../domain.mjs';

// Licensed search-index results: no undocumented/private portal endpoints.
export const REGIONAL_BOARDS=[
  {name:'Naukri',domain:'naukri.com',path:/\/job-listings-/},
  {name:'Instahyre',domain:'instahyre.com',path:/\/job-\d+/},
  {name:'eFinancialCareers',domain:'efinancialcareers.com',path:/\/jobs(?:-|\/).*id(?:[.\/-]|\d)|\/job\/|\/jobs\/[^/]+\/\d+/},
  {name:'IIMJobs',domain:'iimjobs.com',path:/\/j\//},
  {name:'Internshala',domain:'internshala.com',path:/\/(?:internship|job)\/detail\//},
  {name:'Wellfound',domain:'wellfound.com',path:/\/jobs\/\d+/},
];
export function regionalResults(results,query='') {
  return results.flatMap(result=>{
    const url=safeUrl(result.link);if(!url)return [];
    const u=new URL(url),board=REGIONAL_BOARDS.find(b=>(u.hostname===b.domain || u.hostname.endsWith(`.${b.domain}`)) && b.path.test(u.pathname));
    if(!board)return [];
    const label=text(stripHtml(result.title),260).replace(/\s*[|–-]\s*(?:Naukri(?:\.com)?|Instahyre|IIMJobs(?:\.com)?|Internshala|Wellfound|eFinancialCareers).*$/i,'');
    const detail=String(result.snippet || ''),at=label.match(/^(.+?)\s+(?:job\s+)?at\s+([^•|]+)(?:[•|]|$)/i);
    let title=label,company='',location='Not listed';
    if(at){title=at[1].trim();company=at[2].trim();}
    else if(board.name==='IIMJobs') {const parts=label.split(/\s[-–]\s/);if(parts.length>=2){company=parts.shift();title=parts.join(' - ');}}
    else if(board.name==='Naukri') {const parts=label.split(/\s[-–]\s/);if(parts.length>=3 && !/mumbai|delhi|bengaluru|bangalore|noida|gurgaon|gurugram|years?|jobs?/i.test(parts[1])){title=parts[0];company=parts[1];location=parts[2];}}
    const found=`${label} ${detail}`.match(/\b(Mumbai|Bengaluru|Bangalore|Delhi(?: NCR)?|Gurugram|Gurgaon|Noida|Pune|Hyderabad|Chennai)\b/i);
    if(location==='Not listed' && found)location=found[0];
    if(!title)return [];
    return [{id:`regional-${hash(url).slice(0,32)}`,company:company || 'Company not listed',title:text(title,200),location,workMode:/\bremote\b/i.test(`${label} ${detail}`) ? 'Remote' : /\bhybrid\b/i.test(detail) ? 'Hybrid' : 'On-site',type:/internship|\bintern\b/i.test(label) ? 'Internship' : 'Not listed',salary:'Not listed',description:text(stripHtml(detail),4000),url,source:board.name,discoverySource:'India & finance boards',board:query,tags:[],category:'Other',publishedAt:null,postedLabel:result.date || null,fetchedAt:now(),isDemo:false,archived:false,indexedSnippet:true,requiresSourceReview:!company,sourceNote:'Search-index listing. Open the original to confirm requirements and availability.'}];
  });
}
export async function fetchRegional(query,config={},fetcher=fetch) {
  if(!config.SERPAPI_API_KEY)fail('Regional portals use indexed discovery: configure SERPAPI_API_KEY. Free ATS feeds continue.',503);
  const sites=REGIONAL_BOARDS.map(b=>`site:${b.domain}`).join(' OR '),url=new URL('https://serpapi.com/search.json');
  url.search=new URLSearchParams({engine:'google',q:`(${sites}) ${text(query,300)} ${text(config.SEARCH_LOCATION,100)}`,gl:'in',hl:'en',num:'10',tbs:'qdr:m',api_key:config.SERPAPI_API_KEY});
  const data=await remoteJSON(url.href,{},fetcher,45000);
  if(data.error || !Array.isArray(data.organic_results))fail('Regional search is unavailable. Check SerpApi access or quota.',502);
  return regionalResults(data.organic_results,query);
}
