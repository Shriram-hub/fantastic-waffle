import { remoteJSON } from "../http.mjs";
import { id, now, text, emailValid,fail,safeUrl } from "../../domain.mjs";
import {companyDomain} from './company.mjs';
import {contactProviderError} from './errors.mjs';

export const searchHunter=async(domain,key,limit=3,fetcher=fetch)=>(await hunterSearch({domain},key,limit,fetcher)).contacts;
export const searchHunterCompany=(company,key,limit=3,fetcher=fetch)=>hunterSearch({company},key,limit,fetcher);
const normalizedName=value=>String(value || '').toLowerCase().replace(/\b(inc|incorporated|llc|ltd|limited|corporation)\b/g,'').replace(/[^a-z0-9]/g,'');
async function hunterSearch(query, key, limit = 3, fetcher = fetch) {
  if(!key)fail('Configure HUNTER_API_KEY to use Hunter discovery.',503);
  let domain=companyDomain(query.domain);if(!domain && !query.company)fail('Enter a corporate company domain.');
  limit=Math.min(10,Math.max(1,Number(limit) || 3));
  const url = new URL("https://api.hunter.io/v2/domain-search");
  // Filter at the provider, before limiting: an arbitrary first few people
  // often contain no recruiters. Ten results also fit Hunter Free pagination.
  url.search = new URLSearchParams({...domain ? {domain} : {company:text(query.company,150)},api_key:key,limit:'10',department:'hr,executive'});
  let result;try{result=await remoteJSON(url.href,{},fetcher,30000);}catch(error){throw contactProviderError('Hunter',error);}
  if(!Array.isArray(result.data?.emails))fail('Hunter returned an unexpected contact response.',502);
  if(!domain){
    domain=companyDomain(result.data.domain);
    if(!domain || !normalizedName(query.company) || normalizedName(query.company)!==normalizedName(result.data.organization))return {company:null,contacts:[]};
  } else if(result.data.domain && companyDomain(result.data.domain)!==domain)fail('Hunter returned a different company domain; no contacts were saved.',502);
  const contacts=result.data.emails.filter(p=>emailValid(p.value || '') && p.value.split('@')[1]?.toLowerCase()===domain && (/recruit|talent|people|human resources|founder|chief|\b[cfth]eo\b|\bcto\b|engineering manager|head of engineering/i.test(p.position || '') || ['hr','executive'].includes(p.department) || /^(hr|careers?|jobs|recruiting|recruitment|talent|hiring)([._-]|@)/i.test(p.value)))
    .sort((a,b)=>Number(b.verification?.status==='valid')-Number(a.verification?.status==='valid'))
    .slice(0,limit).map(p=>{
      const at=p.verification?.date && Date.parse(p.verification.date),recent=Number.isFinite(at) && at<=Date.now()+86400000 && Date.now()-at<=30*86400000;
      const status=result.data.accept_all || p.verification?.status==='accept_all' ? 'catch-all' : p.verification?.status==='invalid' ? 'invalid' : p.verification?.status==='valid' && recent ? 'verified' : 'unverified';
      const sources=(p.sources || []).map(s=>({url:safeUrl(s.uri),lastSeen:text(s.last_seen_on,40)})).filter(s=>s.url).slice(0,5);
      return {id:id(),name:text([p.first_name,p.last_name].filter(Boolean).join(' '),150) || 'Hiring team',email:p.value.toLowerCase(),company:text(result.data.organization,150),title:text(p.position || p.position_raw,150) || (p.department==='hr' ? 'Human resources' : 'Company contact'),emailStatus:status,source:'Hunter',sources,linkedinUrl:safeUrl(p.linkedin),companyDomain:domain,suppressed:false,isDemo:false,createdAt:now(),verification:{provider:'Hunter',status,at:at ? new Date(at).toISOString() : now(),reference:sources[0]?.url || '',result:status==='verified' ? 'Recently verified by Hunter' : status==='catch-all' ? 'Catch-all domain; blocked from sending' : 'Needs mailbox verification'}};
    });
  return {company:{domain,name:text(result.data.organization,150) || domain,source:'Hunter company search',reference:'https://hunter.io/'},contacts};
}
