import { id, now, text, emailValid,fail,safeUrl } from "../../domain.mjs";
import {companyDomain,cleanCompanyName} from './company.mjs';
import {prioritizeContact} from '../../services/contact-personas.mjs';
import {providerKey} from '../../services/provider-config.mjs';
import {providerJSON} from './provider-http.mjs';

export function cleanHunterDomain(value) {
  let raw=String(value || '').trim();
  try{raw=new URL(/^https?:\/\//i.test(raw)?raw:`https://${raw}`).hostname;}catch{return '';}
  return companyDomain(raw.replace(/^www\./i,''));
}

export const searchHunter=async(domain,key,limit=3,fetcher=fetch)=>(await hunterSearch({domain},key,limit,fetcher)).contacts;
export const searchHunterCompany=(company,key,limit=3,fetcher=fetch,targeting)=>hunterSearch({company,targeting},key,limit,fetcher);
export const searchHunterDomain=(domain,key,limit=3,fetcher=fetch,targeting)=>hunterSearch({domain,targeting},key,limit,fetcher);
const normalizedName=value=>cleanCompanyName(value).toLowerCase().replace(/[^a-z0-9]/g,'');
export async function findHunterEmail(person,domain,key,fetcher=fetch) {
  key=providerKey(key,'hunter');domain=cleanHunterDomain(domain);
  const parts=person.name.trim().split(/\s+/),url=new URL('https://api.hunter.io/v2/email-finder');
  if(parts.length<2 || !companyDomain(domain))return null;
  url.search=new URLSearchParams({domain,first_name:parts[0],last_name:parts.at(-1),api_key:key});
  const result=await providerJSON('Hunter',url.href,{},fetcher,30000,[key]);
  const data=result.data;
  if(!emailValid(data?.email || '') || data.email.split('@')[1].toLowerCase()!==domain)return null;
  const checked=data.verification?.status,status=data.accept_all || checked==='accept_all' ? 'catch-all' : data.disposable || data.webmail ? 'invalid' : checked==='valid' ? 'verified' : checked==='invalid' ? 'invalid' : 'unverified';
  return {...person,email:data.email.toLowerCase(),companyDomain:domain,emailStatus:status,verification:{provider:'Hunter Email Finder',status,at:now(),reference:person.linkedinUrl,result:status==='verified' ? 'Finder returned a verified corporate mailbox' : 'Mailbox verification still required'}};
}
async function hunterSearch(query, key, limit = 3, fetcher = fetch) {
  key=providerKey(key,'hunter');
  if(!key)fail('Configure HUNTER_API_KEY to use Hunter discovery.',503);
  let domain=cleanHunterDomain(query.domain);if(!domain && !query.company)fail('Enter a corporate company domain.');
  limit=Math.min(10,Math.max(1,Number(limit) || 3));
  const url = new URL("https://api.hunter.io/v2/domain-search");
  // Fetch an unfiltered page before ranking locally; department filters can
  // discard the functional manager and consume a search credit for no results.
  url.search = new URLSearchParams({...domain ? {domain} : {company:text(query.company,150)},api_key:key,limit:'10'});
  const result=await providerJSON('Hunter',url.href,{},fetcher,30000,[key]);
  if(!Array.isArray(result.data?.emails))fail('Hunter returned an unexpected contact response.',502);
  if(!domain){
    domain=companyDomain(result.data.domain);
    if(!domain || !normalizedName(query.company) || normalizedName(query.company)!==normalizedName(result.data.organization))return {company:null,contacts:[]};
  } else if(result.data.domain && companyDomain(result.data.domain)!==domain)fail('Hunter returned a different company domain; no contacts were saved.',502);
  const contacts=result.data.emails.filter(p=>emailValid(p.value || '') && p.value.split('@')[1]?.toLowerCase()===domain && (query.targeting || /recruit|talent|people|human resources|founder|chief|\b[cfth]eo\b|\bcto\b|engineering manager|head of engineering/i.test(p.position || '') || ['hr','executive'].includes(p.department) || /^(hr|careers?|jobs|recruiting|recruitment|talent|hiring)([._-]|@)/i.test(p.value)))
    .sort((a,b)=>Number(b.verification?.status==='valid')-Number(a.verification?.status==='valid'))
    .map(p=>{
      const at=p.verification?.date && Date.parse(p.verification.date),recent=Number.isFinite(at) && at<=Date.now()+86400000 && Date.now()-at<=30*86400000;
      const status=result.data.accept_all || p.verification?.status==='accept_all' ? 'catch-all' : p.verification?.status==='invalid' ? 'invalid' : p.verification?.status==='valid' && recent ? 'verified' : 'unverified';
      const sources=(p.sources || []).map(s=>({url:safeUrl(s.uri),lastSeen:text(s.last_seen_on,40)})).filter(s=>s.url).slice(0,5);
      return {id:id(),name:text([p.first_name,p.last_name].filter(Boolean).join(' '),150) || 'Hiring team',email:p.value.toLowerCase(),company:text(result.data.organization,150),title:text(p.position || p.position_raw,150) || (p.department==='hr' ? 'Human resources' : 'Company contact'),emailStatus:status,source:'Hunter',sources,linkedinUrl:safeUrl(p.linkedin),companyDomain:domain,suppressed:false,isDemo:false,createdAt:now(),verification:{provider:'Hunter',status,at:at ? new Date(at).toISOString() : now(),reference:sources[0]?.url || '',result:status==='verified' ? 'Recently verified by Hunter' : status==='catch-all' ? 'Catch-all domain; blocked from sending' : 'Needs mailbox verification'}};
    });
  const pattern=/^(?:[._-]|\{(?:first|last|f|l)\})+$/.test(result.data.pattern || '') ? result.data.pattern : '';
  const ranked=query.targeting ? contacts.map(c=>prioritizeContact(c,query.targeting)).sort((a,b)=>b.priorityScore-a.priorityScore) : contacts;
  return {company:{domain,name:text(result.data.organization,150) || domain,source:'Hunter company search',reference:'https://hunter.io/',pattern},pattern,contacts:ranked.slice(0,limit)};
}
