import {withDeadline,boundedFetcher} from '../deadline.mjs';
import {id,now,text,emailValid,safeUrl,stripHtml} from '../../domain.mjs';
import {remoteJSON} from '../http.mjs';
import {publicCompanyPages} from './public-pages.mjs';
import {permuteEmails} from './permutator.mjs';
import {cleanCompanyName} from './company.mjs';

export function searchHTMLResults(html,engine) {
  if(/captcha|anomaly\.js|unusual traffic|verify you are human/i.test(html))return [];
  const results=[];
  for(const match of String(html).matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi))try {
    let link=match[1].replaceAll('&amp;','&');
    if(engine==='DuckDuckGo'){const u=new URL(link,'https://duckduckgo.com');link=u.searchParams.get('uddg') || u.href;}
    if(engine==='Yahoo' && /\/RU=/.test(link))link=decodeURIComponent(link.split('/RU=')[1].split('/RK=')[0]);
    const u=new URL(link);if(!/(^|\.)linkedin\.com$/.test(u.hostname) || !u.pathname.startsWith('/in/'))continue;
    results.push({link:u.origin+u.pathname,title:stripHtml(match[2]),snippet:stripHtml(html.slice(match.index,match.index+1200)).slice(0,500)});
  }catch{}
  return results.slice(0,10);
}
async function searchText(url,options,fetcher) {
  const r=await fetcher(url,{...options,headers:{'User-Agent':'VeloceBot/1.0 (+career workspace; public search)','Accept':'text/html','Accept-Language':'en-US,en;q=0.8',...options.headers},redirect:'error',signal:AbortSignal.timeout(4000)});
  if(!r.ok){await r.body?.cancel();return '';}
  const reader=r.body?.getReader();if(!reader)return (await r.text()).slice(0,350000);
  const chunks=[];let length=0;
  try {while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>350000){await reader.cancel();return '';}chunks.push(part.value);}}finally{reader.releaseLock();}
  return Buffer.concat(chunks).toString('utf8');
}
export async function searchCompanyPeople(company,domain,options={}) {
  const fetcher=options.fetcher || fetch,q=`site:linkedin.com/in (Recruiter OR "Talent Acquisition" OR "Human Resources" OR "Hiring Manager" OR Director OR Partner) "${text(cleanCompanyName(company),100)}"`,warnings=[];
  if(options.allowSearch && options.call)for(const provider of ['SerpApi','Brave']) {
    const key=options.config?.[provider==='SerpApi' ? 'SERPAPI_API_KEY' : 'BRAVE_SEARCH_API_KEY'];if(!key)continue;
    try {
      const u=new URL(provider==='SerpApi' ? 'https://serpapi.com/search.json' : 'https://api.search.brave.com/res/v1/web/search');
      u.search=new URLSearchParams(provider==='SerpApi' ? {engine:'google',q,num:'5',api_key:key} : {q,count:'5'});
      const data=await options.call(provider,()=>remoteJSON(u.href,provider==='Brave' ? {headers:{'X-Subscription-Token':key}} : {},fetcher,10000));
      const results=provider==='SerpApi' ? data.organic_results || [] : (data.web?.results || []).map(r=>({title:r.title,link:r.url,snippet:r.description}));
      const people=xrayPeople(results,company,domain);if(people.length)return {people,warnings};
    }catch(error){warnings.push(error.status ? error.message : `${provider} search is unavailable.`);}
  }
  if(options.freeSearch!==false) {const results=await Promise.allSettled([
    ['DuckDuckGo','https://lite.duckduckgo.com/lite/',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({q}).toString()}],
    ['DuckDuckGo',`https://html.duckduckgo.com/html/?${new URLSearchParams({q})}`,{}],
    ['Yahoo',`https://search.yahoo.com/search?${new URLSearchParams({p:q})}`,{}]
  ].map(async([engine,url,init])=>xrayPeople(searchHTMLResults(await searchText(url,init,fetcher),engine),company,domain)));const people=results.filter(r=>r.status==='fulfilled').flatMap(r=>r.value);if(people.length)return {people:[...new Map(people.map(p=>[p.linkedinUrl,p])).values()].slice(0,5),warnings};}
  warnings.push('No source-supported people were returned by public search. Browser-assisted import is available on LinkedIn company pages.');
  return {people:[],warnings};
}

export function publicTeamPeople(pages,company,domain) {
  const people=[];
  for(const page of pages)for(const block of page.text.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))try {
    const visit=(node,depth=0)=>{if(!node || depth>6 || typeof node!=='object')return;if(Array.isArray(node)){node.slice(0,30).forEach(v=>visit(v,depth+1));return;}
      if([].concat(node['@type'] || []).includes('Person') && typeof node.name==='string' && /recruit|talent|human resources|chief|founder|director|partner|hiring|head of/i.test(node.jobTitle || '')) {
        const parts=node.name.trim().split(/\s+/);if(parts.length>=2 && parts.length<=5)people.push({name:text(node.name,150),firstName:parts[0],lastName:parts.at(-1),title:text(node.jobTitle,150),company,companyDomain:domain,sources:[{url:page.url}],verification:{reference:page.url,result:'Name and title published on company site; email pattern is unverified'}});
      }
      Object.values(node).filter(v=>typeof v==='object').slice(0,30).forEach(v=>visit(v,depth+1));
    };visit(JSON.parse(block[1]));
  }catch{}
  return people.slice(0,5);
}

export function publishedContacts(content,domain,reference,company) {
  const decoded=String(content).replace(/&#(?:0*64|x0*40);|&commat;/gi,'@').replace(/&#(?:0*46|x0*2e);|&period;/gi,'.');
  const emails=[...new Set((decoded.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []).map(e=>e.toLowerCase()))];
  return emails.filter(email=>emailValid(email) && email.split('@')[1]===domain && /career|recruit|talent|hiring|jobs|people|human[._-]?resources|^hr(?:[._-]|$)|join[._-]?us/i.test(email.split('@')[0])).slice(0,5).map(email=>({id:id(),name:'Hiring team',title:'Public recruiting contact',email,company,emailStatus:'unverified',source:'Public company careers',sources:[{url:safeUrl(reference)}],verification:{provider:'Public page',status:'unverified',reference:safeUrl(reference),result:'Publicly listed; mailbox deliverability has not been verified',at:now()},suppressed:false,isDemo:false,createdAt:now()}));
}
export function xrayPeople(results,company,domain) {
  return results.filter(r=>{try{return /(^|\.)linkedin\.com$/.test(new URL(r.link).hostname) && new URL(r.link).pathname.startsWith('/in/');}catch{return false;}}).flatMap(r=>{
    const title=text(r.title,220),parts=title.split(/\s[-–|]\s/),name=parts[0].replace(/\s*\([^)]*\)/g,'').trim();
    if(!/recruit|talent|human resources|\bhr\b|hiring|engineering manager|head of|\bcto\b|founder|director|vice president|partner/i.test(`${title} ${r.snippet || ''}`) || !`${title} ${r.snippet || ''}`.toLowerCase().includes(cleanCompanyName(company).toLowerCase())) return [];
    const names=name.split(/\s+/);if(names.length<2 || names.length>5) return [];
    return [{firstName:names[0],lastName:names.at(-1),name,title:parts.slice(1).join(' — ').replace(/\s*\|?\s*LinkedIn$/i,''),linkedinUrl:safeUrl(r.link),companyDomain:domain,company}];
  }).slice(0,5);
}
// Zero-key fallback reads actual published recruiting addresses. Search snippets
// require the optional search API; no public, unlimited LinkedIn search API exists.
export async function findPublicContacts(job,company,options={}) {
  const results=await Promise.allSettled([
    withDeadline(signal=>(options.pages || publicCompanyPages)(company.domain,{signal}),4000,options.signal),
    withDeadline(signal=>options.searchPeople ? searchCompanyPeople(job.company,company.domain,{...options,fetcher:boundedFetcher(options.fetcher || fetch,signal)}) : {people:[]},4000,options.signal)
  ]);
  const pages=results[0].status==='fulfilled' ? results[0].value : [],searched=results[1].status==='fulfilled' ? results[1].value : {people:[],warnings:['Public people search reached its deadline.']};
  const contacts=[...publishedContacts(job.description,company.domain,job.url,job.company),...pages.flatMap(p=>publishedContacts(p.text,company.domain,p.url,job.company))];
  for(const person of [...publicTeamPeople(pages,job.company,company.domain),...searched.people]) {
    const candidate=permuteEmails({...person,domainPattern:company.pattern})[0];
    if(candidate)contacts.push({...person,...candidate,id:id(),suppressed:false,isDemo:false,createdAt:now(),sources:person.sources || [{url:person.linkedinUrl}],verification:{provider:'Public source + email pattern',status:'unverified',reference:person.linkedinUrl || person.sources?.[0]?.url,result:'Guessed address; verify the mailbox before sending',at:now()}});
  }
  if(options.warnings)options.warnings.push(...(searched.warnings || []));
  return [...new Map(contacts.map(c=>[c.email,c])).values()].slice(0,5);
}
