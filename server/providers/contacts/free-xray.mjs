import {uniquePeople,profileURL} from '../../../shared/contact-discovery.mjs';
import {withDeadline,boundedFetcher} from '../deadline.mjs';
import {id,now,text,emailValid,safeUrl,stripHtml} from '../../domain.mjs';
import {remoteJSON} from '../http.mjs';
import {publicCompanyPages} from './public-pages.mjs';
import {learnEmailPattern,permuteEmails} from './permutator.mjs';
import {cleanCompanyName} from './company.mjs';
import {contactTargeting,prioritizeContact} from '../../services/contact-personas.mjs';
import {serperSearch,tavilySearch} from './serper-xray.mjs';

export function searchHTMLResults(html,engine) {
  if(/captcha|anomaly\.js|unusual traffic|verify you are human/i.test(html))return [];
  const results=[];
  for(const match of String(html).matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi))try {
    let link=match[1].replaceAll('&amp;','&');
    if(engine==='DuckDuckGo'){const u=new URL(link,'https://duckduckgo.com');link=u.searchParams.get('uddg') || u.href;}
    if(engine==='Yahoo' && /\/RU=/.test(link))link=decodeURIComponent(link.split('/RU=')[1].split('/RK=')[0]);
    const u=new URL(link);if(!/(^|\.)linkedin\.com$/.test(u.hostname) || !/^\/(?:in|posts|pulse)\//.test(u.pathname))continue;
    results.push({link:u.origin+u.pathname,title:stripHtml(match[2]),snippet:stripHtml(html.slice(match.index,match.index+1200)).slice(0,500)});
  }catch{}
  return results.slice(0,100);
}
async function searchText(url,options,fetcher) {
  const r=await fetcher(url,{...options,headers:{'User-Agent':'VeloceBot/1.0 (+career workspace; public search)','Accept':'text/html','Accept-Language':'en-US,en;q=0.8',...options.headers},redirect:'error',signal:AbortSignal.timeout(4000)});
  if(!r.ok){await r.body?.cancel();return '';}
  const reader=r.body?.getReader();if(!reader)return (await r.text()).slice(0,350000);
  const chunks=[];let length=0;
  try {while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>350000){await reader.cancel();return '';}chunks.push(part.value);}}finally{reader.releaseLock();}
  return Buffer.concat(chunks).toString('utf8');
}
export function duckDuckGoNext(html,query) {
  for(const match of String(html).matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/gi)){
    const values={};for(const input of match[1].matchAll(/<input\b[^>]*>/gi)){const name=input[0].match(/\bname=["']([^"']+)["']/i)?.[1],value=input[0].match(/\bvalue=["']([^"']*)["']/i)?.[1];if(name && /^(q|s|dc|v|api|o|vqd|kl|nextParams)$/.test(name) && value?.length<2500)values[name]=value.replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#39;',"'");}
    if(Number(values.s)>0 && (!values.q || values.q===query))return {...values,q:query};
  }
  return null;
}
export function personaQueries(company,targeting,options={}) {
  const clean=v=>text(v,100).replace(/["\r\n]/g,' ').trim(),name=clean(cleanCompanyName(company)),department=clean(options.departmentKeyword || (targeting.field==='general'?'':targeting.label)),location=clean(options.location);
  const base=`site:linkedin.com/in`,tail=`"${name}"${location?` (${location})`:''}`;
  const queries=[
    {tier:'executive',q:`${base} ("Managing Director" OR "Partner" OR "Vice President" OR "VP" OR "Director" OR "Head of") ${tail}`},
    {tier:'management',q:`${base} ("Manager" OR "Lead" OR "Team Lead" OR "Principal" OR "Group Lead") ${tail} "${department}"`},
    {tier:'recruiting',q:`${base} ("Talent Acquisition" OR "Recruiter" OR "HRBP" OR "Campus Recruitment" OR "People Partner") ${tail}`},
    {tier:'specialist',q:`${base} ("Senior Analyst" OR "Associate Director" OR "Senior Consultant" OR "Staff") ${tail} "${department}"`},
  ];
  if(targeting.reporting.length)queries.unshift({tier:'reporting',q:`${base} (${[...targeting.reporting.map(r=>r.value),...targeting.titles].slice(0,12).map(t=>`"${clean(t)}"`).join(' OR ')}) "${name}"`});
  queries.push({tier:'hiring',q:`(site:linkedin.com/posts OR site:linkedin.com/pulse) ("hiring" OR "looking for" OR "open role" OR "join my team") "${name}" "${clean(options.job?.title || targeting.label)}"`});
  return queries;
}
export async function searchCompanyPeople(company,domain,options={}) {
  const fetcher=options.fetcher || fetch,targeting=options.targeting || contactTargeting(options.job),targetCount=Math.max(1,Math.min(100,options.targetCount || options.peopleLimit || 50)),warnings=[],deep=options.targetCount!==undefined,deadline=Date.now()+(deep?36000:3500);
  const queries=personaQueries(company,targeting,options).filter(q=>options.targetPersona==='hiring-poster'?q.tier==='hiring':!deep || q.tier!=='hiring'),states=queries.map(query=>({...query,provider:0,page:1,ended:false})),collected=[];
  const providers=[];
  if(options.allowSearch && options.call)for(const [name,field] of [['Serper','SERPER_API_KEY'],['Tavily','TAVILY_API_KEY'],['SerpApi','SERPAPI_API_KEY'],['Brave','BRAVE_SEARCH_API_KEY']])if(options.config?.[field])providers.push({name,key:options.config[field]});
  if(options.freeSearch!==false)providers.push({name:'DuckDuckGo'},{name:'Yahoo'});
  async function pageFor(state) {
    while(state.provider<providers.length && Date.now()<deadline) {
      const {name,key}=providers[state.provider],page=state.page,q=state.q,requestKey=`${q}\npage:${page}`;
      try {
        let results=[],more=true;
        if(name==='Serper'){const data=await options.call(name,()=>serperSearch(q,key,{fetcher,limit:50,page,timeout:4000}),requestKey);results=data.results;}
        else if(name==='Tavily'){const data=await options.call(name,()=>tavilySearch(q,key,{fetcher,limit:20}),requestKey);results=data.results;more=false;}
        else if(name==='SerpApi' || name==='Brave'){
          const u=new URL(name==='SerpApi'?'https://serpapi.com/search.json':'https://api.search.brave.com/res/v1/web/search');
          // Brave offset is a zero-based PAGE index, not a result offset.
          u.search=new URLSearchParams(name==='SerpApi'?{engine:'google',q,num:'20',start:String((page-1)*20),api_key:key}:{q,count:'20',offset:String(page-1)});
          const data=await options.call(name,()=>remoteJSON(u.href,name==='Brave'?{headers:{'X-Subscription-Token':key}}:{},fetcher,4000),requestKey);
          results=name==='SerpApi'?data.organic_results || []:(data.web?.results || []).map(r=>({title:r.title,link:r.url,snippet:r.description}));if(name==='Brave' && data.query?.more_results_available===false)more=false;
        }else if(name==='DuckDuckGo'){
          const html=await searchText('https://lite.duckduckgo.com/lite/',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(state.nextDDG || {q,s:String((page-1)*30)}).toString()},fetcher);
          results=searchHTMLResults(html,'DuckDuckGo');state.nextDDG=duckDuckGoNext(html,q);more=!!state.nextDDG;
        }else{results=searchHTMLResults(await searchText(`https://search.yahoo.com/search?${new URLSearchParams({p:q,b:String((page-1)*10+1)})}`,{},fetcher),'Yahoo');}

        const parsed=[...xrayPeople(results,company,domain,targeting),...activeHiringPeople(results,company,domain,targeting)].map(p=>({...p,searchTier:state.tier,department:targeting.label}));
        const seen=state.seen || new Set(),fresh=parsed.filter(p=>{const key=p.linkedinUrl || p.hiringPost?.url || p.name;if(seen.has(key))return false;seen.add(key);return true;});state.seen=seen;
        if(results.length && fresh.length){state.page++;if(!deep || !more || state.page>5){state.provider++;state.page=1;state.seen=new Set();}return fresh;}
        state.provider++;state.page=1;state.seen=new Set();
      }catch(error){warnings.push(error.status?error.message:`${name} people search was unavailable or reached its deadline.`);state.provider++;state.page=1;state.seen=new Set();}
    }
    state.ended=true;return [];
  }
  for(let round=0;round<5 && states.some(s=>!s.ended) && Date.now()<deadline;round++) {
    const rows=await Promise.allSettled(states.filter(s=>!s.ended).map(pageFor));collected.push(...rows.filter(r=>r.status==='fulfilled').flatMap(r=>r.value));
    if(uniquePeople(collected).length>=targetCount || !deep)break;
  }
  const people=uniquePeople(collected.map(p=>prioritizeContact(p,targeting)).sort((a,b)=>b.priorityScore-a.priorityScore)).slice(0,targetCount);
  if(!people.length)warnings.push('No source-supported people were returned. Use the LinkedIn extension on a profile or company People page.');
  if(people.length<targetCount)warnings.push(`Found ${people.length} of ${targetCount} requested profiles. Indexed results, source availability and provider quotas determine coverage.`);
  return {people,warnings:[...new Set(warnings)].slice(0,6)};
}

export function activeHiringPeople(results,company,domain,targeting=contactTargeting()) {
  const result=[],companyName=cleanCompanyName(company).toLowerCase();
  for(const r of results) {
    let url;try{url=new URL(r.link);}catch{continue;}
    if(url.protocol!=='https:' || !/(^|\.)linkedin\.com$/.test(url.hostname) || !/^\/(?:posts|pulse)\//.test(url.pathname))continue;
    const title=text(r.title,300),snippet=text(r.snippet,1200),content=`${title} ${snippet}`;
    if(!/\bhiring\b|looking for|open role|join my team/i.test(content) || !content.toLowerCase().includes(companyName))continue;
    // An indexed post is a hiring signal, not evidence its author works at the company.
    const author=(typeof r.author==='string'?r.author:r.author?.name) || title.match(/^([\p{L}][\p{L}'’. -]{3,65}?)\s+(?:on LinkedIn\s*:|\|\s*LinkedIn)/iu)?.[1];
    if(!author || !/^[\p{L}][\p{L}'’-]+(?:\s+[\p{L}][\p{L}'’-]+){1,3}$/u.test(author.trim()))continue;
    const headline=text(r.author?.headline || '',150),employerSupported=headline.toLowerCase().includes(companyName);
    const parts=author.trim().split(/\s+/);
    result.push(prioritizeContact({name:author.trim(),firstName:parts[0],lastName:parts.at(-1),title:headline || 'Public hiring-post author',company,companyDomain:domain,companyAssociation:employerSupported?'public headline':'hiring post only',employerSupported,linkedinUrl:safeUrl(r.author?.url),activeHiringPoster:true,hiringPost:{url:url.href,quote:content.slice(0,900),at:now()},sources:[{url:url.href}],email:'',emailStatus:'unverified'},targeting));
  }
  return result.slice(0,5);
}

export function publicTeamPeople(pages,company,domain) {
  const people=[];
  for(const page of pages)for(const block of page.text.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))try {
    const visit=(node,depth=0)=>{if(!node || depth>6 || typeof node!=='object')return;if(Array.isArray(node)){node.slice(0,30).forEach(v=>visit(v,depth+1));return;}
      if([].concat(node['@type'] || []).includes('Person') && typeof node.name==='string' && /recruit|talent|human resources|chief|founder|director|partner|hiring|head of|manager|senior|engineer|analyst|principal|controller/i.test(node.jobTitle || '')) {
        const parts=node.name.trim().split(/\s+/),email=String(node.email || '').replace(/^mailto:/,'').toLowerCase();if(parts.length>=2 && parts.length<=5)people.push({name:text(node.name,150),firstName:parts[0],lastName:parts.at(-1),title:text(node.jobTitle,150),company,companyDomain:domain,...(emailValid(email) && email.endsWith(`@${domain}`)?{email,emailStatus:'unverified',source:'Public company team page'}:{}),sources:[{url:page.url}],verification:{reference:page.url,result:'Name and title published on company site; mailbox is unverified'}});
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
export function namedPublishedContacts(content,domain,reference,company) {
  const contacts=[];
  for(const match of String(content).matchAll(/<a\b[^>]*href=["']mailto:([^"'?\s]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi))try {
    const email=decodeURIComponent(match[1]).toLowerCase(),name=stripHtml(match[2]).trim(),parts=name.split(/\s+/);
    if(!emailValid(email) || !email.endsWith(`@${domain}`) || !/^[\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+){1,3}$/u.test(name) || /hiring|recruit|sales|support|team|contact|press/i.test(name))continue;
    contacts.push({id:id(),name,firstName:parts[0],lastName:parts.at(-1),title:'Named company contact',email,company,companyDomain:domain,emailStatus:'unverified',source:'Public named company contact',sources:[{url:reference}],verification:{provider:'Public page',status:'unverified',reference,result:'Named address published on company site; mailbox unverified',at:now()},isDemo:false,suppressed:false,createdAt:now()});
  }catch{}
  return contacts.slice(0,10);
}
export function xrayPeople(results,company,domain,targeting=contactTargeting()) {
  return results.filter(r=>{try{return !!profileURL(r.link);}catch{return false;}}).flatMap(r=>{
    const title=text(r.title,220),parts=title.split(/\s[-–|]\s/),name=parts[0].replace(/\s*\([^)]*\)/g,'').trim();
    if(!/recruit|talent|human resources|\bhr\b|hiring|manager|head of|\bc[tfmo]o\b|founder|director|vice president|partner|principal|lead|senior|staff|associate|hrbp|controller|\bvp\b/i.test(`${title} ${r.snippet || ''}`) || !`${title} ${r.snippet || ''}`.toLowerCase().includes(cleanCompanyName(company).toLowerCase())) return [];
    const names=name.split(/\s+/);if(!/^[\p{L}][\p{L}\p{M}'’. -]+$/u.test(name) || names.length<2 || names.length>5) return [];
    return [prioritizeContact({firstName:names[0],lastName:names.at(-1),name,title:parts.slice(1).join(' — ').replace(/\s*\|?\s*LinkedIn$/i,''),linkedinUrl:profileURL(r.link),companyDomain:domain,company,companyAssociation:'Indexed company mention; current employment needs review',sources:[{url:safeUrl(r.link)}]},targeting)];
  }).slice(0,100);
}
// Zero-key fallback reads actual published recruiting addresses. Search snippets
// require the optional search API; no public, unlimited LinkedIn search API exists.
export async function findPublicContacts(job,company,options={}) {
  const results=await Promise.allSettled([
    withDeadline(signal=>(options.pages || publicCompanyPages)(company.domain,{signal}),4000,options.signal),
    withDeadline(signal=>options.searchPeople ? searchCompanyPeople(job.company,company.domain,{...options,job,fetcher:boundedFetcher(options.fetcher || fetch,signal)}) : {people:[]},options.targetCount!==undefined?42000:4000,options.signal)
  ]);
  const pages=results[0].status==='fulfilled' ? results[0].value : [],searched=results[1].status==='fulfilled' ? results[1].value : {people:[],warnings:['Public people search reached its deadline.']};
  const contacts=[...publishedContacts(job.description,company.domain,job.url,job.company),...pages.flatMap(p=>[...publishedContacts(p.text,company.domain,p.url,job.company),...namedPublishedContacts(p.text,company.domain,p.url,job.company)])];
  const people=[...publicTeamPeople(pages,job.company,company.domain),...searched.people];
  company.learnedPattern=learnEmailPattern([...contacts,...people],company.domain,company.learnedPattern) || company.learnedPattern;
  for(const person of people) {
    const candidate=person.email ? person : person.activeHiringPoster && !person.employerSupported ? person : permuteEmails({...person,domainPattern:company.learnedPattern?.pattern || company.pattern})[0];
    if(candidate)contacts.push({...person,...candidate,id:id(),suppressed:false,isDemo:false,createdAt:now(),sources:person.sources || [{url:person.linkedinUrl}],verification:person.email ? person.verification : {provider:'Public source + email pattern',status:'unverified',reference:person.linkedinUrl || person.sources?.[0]?.url,result:'Guessed address; verify the mailbox before sending',at:now()}});
  }
  if(options.warnings)options.warnings.push(...(searched.warnings || []));
  const targeting=options.targeting || contactTargeting(job);
  return [...new Map(contacts.map(c=>prioritizeContact(c,targeting)).sort((a,b)=>b.priorityScore-a.priorityScore).map(c=>[c.email || c.hiringPost?.url || c.linkedinUrl,c])).values()].slice(0,options.targetCount || options.peopleLimit || 12);
}
