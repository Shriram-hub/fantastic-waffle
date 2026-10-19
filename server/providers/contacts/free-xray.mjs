import {id,now,text,emailValid,safeUrl} from '../../domain.mjs';
import {remoteJSON} from '../http.mjs';
import {publicCompanyPages} from './public-pages.mjs';
import {permuteEmails} from './permutator.mjs';

export function publishedContacts(content,domain,reference,company) {
  const emails=[...new Set((String(content).match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []).map(e=>e.toLowerCase()))];
  return emails.filter(email=>emailValid(email) && email.split('@')[1]===domain && /career|recruit|talent|hiring|jobs|people/i.test(email.split('@')[0])).slice(0,5).map(email=>({id:id(),name:'Hiring team',title:'Public recruiting contact',email,company,emailStatus:'unverified',source:'Public company careers',verification:{provider:'Public page',status:'unverified',reference:safeUrl(reference),result:'Publicly listed; mailbox deliverability has not been verified',at:now()},suppressed:false,isDemo:false,createdAt:now()}));
}
export function xrayPeople(results,company,domain) {
  return results.filter(r=>{try{return /(^|\.)linkedin\.com$/.test(new URL(r.link).hostname) && new URL(r.link).pathname.startsWith('/in/');}catch{return false;}}).flatMap(r=>{
    const title=text(r.title,220),parts=title.split(/\s[-–|]\s/),name=parts[0].replace(/\s*\([^)]*\)/g,'').trim();
    if(!/recruit|talent|hiring|engineering manager|head of|\bcto\b|founder|marketing director/i.test(`${title} ${r.snippet || ''}`) || !`${title} ${r.snippet || ''}`.toLowerCase().includes(company.toLowerCase())) return [];
    const names=name.split(/\s+/);if(names.length<2 || names.length>5) return [];
    return [{firstName:names[0],lastName:names.at(-1),name,title:parts.slice(1).join(' — ').replace(/\s*\|?\s*LinkedIn$/i,''),linkedinUrl:safeUrl(r.link),companyDomain:domain,company}];
  }).slice(0,5);
}
// Zero-key fallback reads actual published recruiting addresses. Search snippets
// require the optional search API; no public, unlimited LinkedIn search API exists.
export async function findPublicContacts(job,company,options={}) {
  const pages=await (options.pages || publicCompanyPages)(company.domain);
  const contacts=[...publishedContacts(job.description,company.domain,job.url,job.company),...pages.flatMap(p=>publishedContacts(p.text,company.domain,p.url,job.company))];
  if(options.allowSearch && options.config?.SERPAPI_API_KEY && options.call) {
    try {
      const url=new URL('https://serpapi.com/search.json');url.search=new URLSearchParams({engine:'google',q:`site:linkedin.com/in (recruiter OR "Talent Acquisition" OR "Engineering Manager" OR CTO) "${text(job.company,100)}"`,num:'5',api_key:options.config.SERPAPI_API_KEY});
      const result=await options.call(()=>remoteJSON(url.href,{},options.fetcher || fetch));
      for(const person of xrayPeople(result.organic_results || [],job.company,company.domain)) {
        const candidate=permuteEmails(person)[0];
        if(candidate) contacts.push({...person,...candidate,id:id(),suppressed:false,isDemo:false,createdAt:now(),verification:{provider:'Public search + name pattern',status:'unverified',reference:person.linkedinUrl,result:'Guessed address; not sendable',at:now()}});
      }
    } catch {}
  }
  return [...new Map(contacts.map(c=>[c.email,c])).values()].slice(0,5);
}
