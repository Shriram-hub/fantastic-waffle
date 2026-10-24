// Classic content script. Module consumers use linkedin.mjs.
(()=>{
'use strict';
function extractLinkedInCompanyPeople(options) {
  const opts=options || {},initial=location.href,clean=el=>String(el?.innerText || el?.textContent || '').trim(),flat=v=>String(v || '').replace(/\s+/g,' ').trim(),visible=el=>el && !el.closest('[hidden],[aria-hidden="true"],aside,nav,footer') && getComputedStyle(el).display!=='none' && getComputedStyle(el).visibility!=='hidden';
  if(!/(^|\.)linkedin\.com$/.test(location.hostname) || !/^\/(?:company\/|jobs\/view\/|search\/results\/people)/.test(location.pathname))throw Error('Open a LinkedIn company People page or people search.');
  const isSearch=location.pathname.startsWith('/search/'),slug=location.pathname.match(/^\/company\/([^/]+)/)?.[1],query=new URL(location.href).searchParams.get('keywords') || '';
  const inferred=query.split(/\b(?:director|manager|recruiter|head of|talent|senior|engineering|finance|analyst|partner)\b/i)[0].trim();
  let company=flat(opts.company) || flat(clean(document.querySelector('.org-top-card-summary__title,[data-testid="job-details-company-name"],.job-details-jobs-unified-top-card__company-name')) || (!isSearch?clean(document.querySelector('main h1,h1')):''));
  if(!company && slug)company=decodeURIComponent(slug).replace(/-/g,' ');
  if(!company && !isSearch)company=document.title.replace(/\s*[:|·-]\s*(?:People|LinkedIn).*$/i,'').trim();
  if(!company && isSearch && inferred && inferred!==query)company=inferred;
  if(isSearch && !company && !opts.contextOnly)throw Error('Enter a target company or open a company-filtered people search before harvesting.');
  const normalizeName=value=>flat(value).replace(/^View\s+/i,'').replace(/[’']s\s+profile.*$/i,'').split(/[,|·•]/)[0].replace(/\([^)]*\)/g,' ').replace(/^(?:Dr|Prof|Mr|Ms|Mrs|CA)\.?\s+/i,'').replace(/\b(?:CFA|MBA|CPA|ACA|CA|Ph\.?D|PMP|FRM|ACCA|LLB|B\.?Tech|M\.?Tech)\b\.?/gi,(match,offset,whole)=>whole.trim().split(/\s+/).length>2?' ':match).replace(/\s+(?:Ex-\S+|1st|2nd|3rd\+?|4th)\b.*$/i,'').replace(/\s+/g,' ').trim();
  const urlFor=value=>{try{const u=new URL(value,location.href);return u.protocol==='https:' && /(^|\.)linkedin\.com$/.test(u.hostname) && /^\/in\/[a-z0-9_%.-]+\/?$/i.test(u.pathname)?`https://www.linkedin.com${u.pathname.replace(/\/$/,'').toLowerCase()}`:'';}catch{return '';}};
  const validName=name=>/^[\p{L}][\p{L}\p{M}'’. -]+$/u.test(name) && name.split(/\s+/).length>=2 && name.length<130;
  const people=new Map(),count=Math.min(100,Math.max(1,Number(opts.targetCount)||100)),startY=window.scrollY,main=document.querySelector('main'),startMain=main?.scrollTop || 0,duration=Math.min(8000,Math.max(0,Number(opts.duration ?? 5000))),steps=duration?10:1;
  const parseCompany=line=>flat(line).match(/(?:\bCurrent:\s*.*?\bat\s+|\bat\s+|\s@\s)([^|\n·•]+)/i)?.[1]?.trim() || '';
  const add=(record)=>{const name=normalizeName(record.name),url=urlFor(record.linkedinUrl);if(!validName(name) || !url || people.has(url))return;const names=name.split(/\s+/);people.set(url,{...record,name,fullName:name,firstName:names[0],lastName:names.at(-1),linkedinUrl:url,profileUrl:url});};
  const collect=()=>{
    if(location.href!==initial)throw Error('The LinkedIn page changed. Start again on the new page.');
    if(document.querySelector('iframe[src*="captcha"]'))throw Error('Complete LinkedIn verification before continuing.');
    for(const anchor of document.querySelectorAll('main a[href*="/in/"],li a[href*="/in/"],.org-people-profile-card a[href*="/in/"]')){
      if(!visible(anchor))continue;const url=urlFor(anchor.href);if(!url)continue;
      let card=anchor.closest('li,[data-view-name="profile-card"],[data-view-name="search-entity-result-universal-template"],.org-people-profile-card,.entity-result,.artdeco-card,[data-view-name="profile-component-entity"]');
      if(!card){card=anchor.parentElement;for(let d=0;card && d<3 && flat(clean(card)).length<35;d++)card=card.parentElement;}
      if(!visible(card) || card===main || card===document.body)continue;
      const lines=clean(card).split(/\n+/).map(flat).filter(Boolean),titleNode=card.querySelector('.artdeco-entity-lockup__title,.entity-result__title-text [aria-hidden="true"],h3,h2'),name=normalizeName(clean(anchor.querySelector('span[aria-hidden="true"]') || titleNode || anchor).split('\n')[0] || anchor.getAttribute('aria-label') || '');
      const headline=flat(clean(card.querySelector('.artdeco-entity-lockup__subtitle,.entity-result__primary-subtitle,.lt-line-clamp--multi-line,.t-14.t-black--light,[data-anonymize="headline"]'))) || lines.find(v=>v!==name && !/^(?:connect|follow|message|view|\d+(?:st|nd|rd)|show)/i.test(v)) || '';
      const association=lines.find(l=>/^Current:/i.test(l)) || headline,companyAnchor=card.querySelector('a[href*="/company/"]'),employer=flat(clean(companyAnchor)) || parseCompany(association);
      if(isSearch && company && !flat(clean(card)).toLowerCase().includes(company.toLowerCase()) && employer.toLowerCase()!==company.toLowerCase())continue;
      add({name,title:headline.slice(0,200),company:employer || company,companyLinkedinUrl:companyAnchor?.href || '',linkedinUrl:url,location:flat(clean(card.querySelector('.entity-result__secondary-subtitle,.artdeco-entity-lockup__caption,[data-anonymize="location"]'))).slice(0,150),extractionSource:'Visible profile card'});
      if(people.size>=count)break;
    }
    // Read only hydration already present in the document. No Voyager requests.
    if(people.size<count){let bytes=0,visited=0;for(const code of [...document.querySelectorAll('code')].slice(0,30)){
      const raw=String(code.textContent || '').trim().replace(/^<!--\s*|\s*-->$/g,'');bytes+=raw.length;if(bytes>1000000)break;if(!/^[{[]/.test(raw))continue;
      try{const pending=[JSON.parse(raw)];while(pending.length && visited++<8000 && people.size<count){const value=pending.pop();if(!value || typeof value!=='object')continue;
        if(typeof value.firstName==='string' && typeof value.lastName==='string' && typeof value.publicIdentifier==='string'){
          const occupation=flat(value.occupation || value.headline),url=urlFor(`https://www.linkedin.com/in/${value.publicIdentifier}`),known=people.has(url),linked=[...document.querySelectorAll('main a[href*="/in/"]')].some(a=>urlFor(a.href)===url);
          if(known || linked || company && occupation.toLowerCase().includes(company.toLowerCase()))add({name:`${value.firstName} ${value.lastName}`,title:occupation.slice(0,200),company:parseCompany(occupation) || company,linkedinUrl:url,location:'',extractionSource:'Embedded page profile data'});
        }
        for(const child of Object.values(value).slice(0,100))if(child && typeof child==='object')pending.push(child);
      }}catch{}
    }}
    const detail={count:people.size,target:count};window.dispatchEvent(new CustomEvent('veloce:scan-progress',{detail}));
    try{globalThis.chrome?.runtime?.sendMessage?.({type:'linkedin-scan-progress',...detail})?.catch?.(()=>{});}catch{}
  };
  const result=()=>{if(!people.size && !opts.contextOnly)throw Error('No supported profiles are loaded. Open People, scroll to load cards, or open one profile.');return {company,profiles:[...people.values()].slice(0,count),sourceUrl:location.origin+location.pathname};};
  if(!options){collect();return result();}
  return (async()=>{try{for(let step=0;step<steps;step++){collect();if(opts.contextOnly || people.size>=count || step===steps-1)break;const distance=Math.max(window.innerHeight || 800,850);if(main && main.scrollHeight>main.clientHeight+100 && /auto|scroll/.test(getComputedStyle(main).overflowY))main.scrollTop+=Math.max(500,main.clientHeight*.9);window.scrollBy({top:distance,behavior:'smooth'});await new Promise(resolve=>setTimeout(resolve,duration/(steps-1)));}return result();}finally{if(location.href===initial){window.scrollTo({top:startY,behavior:'instant'});if(main)main.scrollTop=startMain;}}})();
}
function extractLinkedInProspect() {
  if(!/(^|\.)linkedin\.com$/.test(location.hostname) || !/^\/in\/[^/]+(?:\/overlay\/contact-info)?\/?$/.test(location.pathname))throw Error('Open an individual LinkedIn profile to get an email.');
  const text=el=>String(el?.innerText || el?.textContent || '').trim(),flat=v=>String(v || '').replace(/\s+/g,' ').trim(),slug=decodeURIComponent(location.pathname.split('/')[2]).toLowerCase();
  const normalizeName=v=>flat(v).replace(/^View\s+/i,'').replace(/[’']s\s+profile.*$/i,'').split(/[,|·•]/)[0].replace(/\([^)]*\)/g,' ').replace(/^(?:Dr|Prof|Mr|Ms|Mrs|CA)\.?\s+/i,'').replace(/\b(?:CFA|MBA|CPA|ACA|CA|Ph\.?D|PMP|FRM|ACCA|LLB|B\.?Tech|M\.?Tech)\b\.?/gi,(match,offset,whole)=>whole.trim().split(/\s+/).length>2?' ':match).replace(/\s+(?:Ex-\S+|1st|2nd|3rd\+?)\b.*$/i,'').replace(/\s+/g,' ').trim();
  let embedded=null,visited=0,bytes=0;const entities=[];
  for(const code of [...document.querySelectorAll('code')].slice(0,30)){const raw=String(code.textContent || '').trim().replace(/^<!--\s*|\s*-->$/g,'');bytes+=raw.length;if(bytes>1000000)break;try{const pending=[JSON.parse(raw)];while(pending.length && visited++<8000){const node=pending.pop();if(!node || typeof node!=='object')continue;entities.push(node);if(String(node.publicIdentifier || '').toLowerCase()===slug && node.firstName && node.lastName)embedded=node;for(const v of Object.values(node).slice(0,100))if(v && typeof v==='object')pending.push(v);}}catch{}}
  const main=document.querySelector('main,[role="main"]');
  const headings=[...document.querySelectorAll('main h1,[role="main"] h1,[data-view-name*="profile-top-card"] h2,main h2,[role="main"] h2,main [role="heading"],[role="main"] [role="heading"]')];
  const heading=headings.find(el=>{const value=normalizeName(text(el));return !el.closest('aside,nav,[hidden],[aria-hidden="true"]') && value.split(/\s+/).length>=2 && value.length<130 && !/^(?:people |more profiles|similar profiles|who your viewers|about|experience|education|activity|recommendations|suggested for you)/i.test(value);}) || document.querySelector('h1');
  // LinkedIn's redesigned profile uses h2/role=heading; metadata is only a fallback on the active profile URL.
  const metadata=document.querySelector('meta[property="og:title"]')?.content || document.title;
  const canonical=document.querySelector('link[rel="canonical"]')?.href;
  const metadataBound=canonical && (()=>{try{return new URL(canonical).pathname.replace(/\/$/,'').toLowerCase()===location.pathname.replace(/\/overlay\/contact-info\/?$/,'').replace(/\/$/,'').toLowerCase();}catch{return false;}})();
  const metaName=metadataBound && /\bLinkedIn\b/i.test(metadata) ? metadata.replace(/^\(\d+\)\s*/,'').split(/\s*[|–—]\s*|\s+-\s+/)[0] : '';
  const header=heading?.closest('section,[data-view-name*="profile-top-card"],.pv-top-card') || heading?.parentElement?.parentElement || main;
  const name=normalizeName(text(heading) || (embedded?`${embedded.firstName} ${embedded.lastName}`:metaName));
  if(!name || name.split(/\s+/).length<2)throw Error('The profile header is still loading. Wait a moment, then try Get email again.');
  const explicit=(header?.querySelector('[aria-label*="Current company" i]') || main?.querySelector('[aria-label*="Current company" i]')),companyText=explicit?.getAttribute('aria-label')?.match(/Current company\s*:?\s*(.+)/i)?.[1];
  const companyLink=header?.querySelector('a[href*="/company/"]');
  let company=flat(companyText || text(explicit) || text(header?.querySelector('.pv-text-details__right-panel-item-text')) || text(companyLink) || companyLink?.getAttribute('aria-label') || companyLink?.querySelector('img')?.getAttribute('alt') || '').replace(/\s+logo$/i,'').replace(/^Current company\s*[:,.]?\s*/i,'').replace(/[.,;]\s*(?:Click(?:ing)?|Select|Go|Skip|Open|View|Press|Tap)\b.*$/i,'').replace(/\s+(?:Click(?:ing)?|Tap) (?:to|this|here)\b.*$/i,''),title=flat(text(header?.querySelector('.text-body-medium,[data-anonymize="headline"],.pv-text-details__left-panel .text-body-medium')) || embedded?.occupation || embedded?.headline);
  if(!title && heading){let next=heading.nextElementSibling || heading.parentElement?.nextElementSibling;for(let i=0;next && i<4;i++,next=next.nextElementSibling){const line=flat(text(next));if(line && line!==name && line.length<250 && !/connections|followers|contact info|^\d+/.test(line)){title=line;break;}}}
  const owned=new Set([embedded?.entityUrn,embedded?.profileUrn].filter(Boolean)),related=[];
  if(embedded){const pending=[embedded],seen=new Set();while(pending.length && seen.size<1500){const node=pending.pop();if(!node || typeof node!=='object' || seen.has(node))continue;seen.add(node);related.push(node);for(const [key,value] of Object.entries(node)){if(value && typeof value==='object')pending.push(value);else if(key.startsWith('*') && typeof value==='string'){const found=entities.find(e=>e.entityUrn===value);if(found)pending.push(found);}}}}
  related.push(...entities.filter(e=>owned.has(e.profileUrn) || owned.has(e['*profile'])));
  const position=related.find(e=>/Position/i.test(e.$type || '') && (e.companyName || e.company) && e.timePeriod?.endDate==null && e.endDate==null);
  const organization=position && entities.find(e=>e.entityUrn===(position.companyUrn || position['*company']) && /Company|Organization/.test(e.$type || ''));
  let companyUrn=position?.companyUrn || position?.['*company'] || '',companyLinkedinUrl=companyLink?.href || '';
  if(position){company=flat(position.companyName || organization?.name || position.company?.name) || company;if(!title)title=flat(position.title);if(organization?.universalName)companyLinkedinUrl=`https://www.linkedin.com/company/${encodeURIComponent(organization.universalName)}/`;}
  const experience=document.getElementById('experience')?.closest('section') || [...document.querySelectorAll('section')].find(s=>/^Experience$/i.test(text(s.querySelector('h2'))));
  if(!company && experience){const rows=[...experience.querySelectorAll('li')];for(const row of rows.filter(r=>/\bPresent\b|\bCurrent\b/i.test(text(r)))){const link=row.querySelector('a[href*="/company/"]'),candidate=flat(text(link?.querySelector('[aria-hidden="true"]') || link) || text(row.querySelector('.t-14.t-normal span[aria-hidden="true"],.artdeco-entity-lockup__subtitle')));if(candidate){company=candidate.split(/\s*[·|]\s*/)[0];break;}}}
  if(!company){const match=title.match(/(?:\bat\s+|\s@\s)([^|·]+)$/i);if(match)company=match[1].trim();}
  let domain='',website='';
  for(const a of header?.querySelectorAll('a[href]') || [])try{const u=new URL(a.href);if(u.protocol==='https:' && !/(^|\.)(linkedin\.com|licdn\.com|github\.com|google\.com)$/.test(u.hostname) && /company website|official website|website/i.test(`${a.getAttribute('aria-label') || ''} ${text(a)}`)){domain=u.hostname.replace(/^www\./,'');website=u.href;break;}}catch{}
  const url=`https://www.linkedin.com/in/${location.pathname.split('/')[2].toLowerCase()}`,parts=name.split(/\s+/),about=document.getElementById('about')?.closest('section') || main?.querySelector('[data-section="about"],[data-view-name="profile-card-about"]'),contactDialog=document.querySelector('[role="dialog"] .pv-contact-info,[role="dialog"] [data-view-name="profile-contact-info"]');
  const direct=[...new Set([about,contactDialog || (location.pathname.includes('/overlay/contact-info')?document.querySelector('[role="dialog"]'):null)].filter(Boolean).flatMap(el=>[...text(el).matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)].map(m=>m[0].toLowerCase())))];
  const directEmail=direct.length===1?direct[0]:'';
  return {company:company.slice(0,150),domain,companyWebsite:website,companyLinkedinUrl,companyUrn,sourceUrl:url,profiles:[{name,fullName:name,firstName:parts[0],lastName:parts.at(-1),title:title.slice(0,200),company,companyLinkedinUrl,companyUrn,directEmail,...(directEmail?{emailEvidence:{kind:'linkedin-profile-text',reference:url}}:{}),linkedinUrl:url,profileUrl:url,profileUrn:embedded?.entityUrn || embedded?.profileUrn || '',location:flat(text(header?.querySelector('.text-body-small.inline.t-black--light,[data-anonymize="location"]'))).slice(0,150)}]};
}
// Same-origin, user-triggered reads. Session cookies/CSRF stay inside this tab.
function getLinkedInCsrfToken(){const match=document.cookie.match(/(?:^|;\s*)JSESSIONID=(?:"([^";]+)"|([^;]+))/);return String(match?.[1] || match?.[2] || '').trim().slice(0,256);}
async function fetchLinkedInVoyagerJson(value){
  const url=new URL(value,location.origin);
  if(!/(^|\.)linkedin\.com$/.test(location.hostname) || url.origin!==location.origin || !/^\/voyager\/api\/(?:identity\/profiles\/[^/]+\/profileContactInfo|organization\/companies)$/.test(url.pathname))throw Error('Unsupported LinkedIn data request.');
  const token=getLinkedInCsrfToken();if(!token || document.querySelector('iframe[src*="captcha"]'))return null;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),2200);
  try{const response=await fetch(url.href,{credentials:'same-origin',redirect:'error',signal:controller.signal,headers:{'csrf-token':token,accept:'application/vnd.linkedin.normalized+json+2.1','x-restli-protocol-version':'2.0.0'}});if(!response.ok)return null;const raw=await response.text();if(raw.length>1500000)return null;return JSON.parse(raw);}catch{return null;}finally{clearTimeout(timer);}
}
function readLinkedInContactInfo(payload,{profileUrl,profileUrn=''}={}){
  const address=value=>typeof value==='string' && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value) && !/[\r\n]/.test(value)?value.toLowerCase():'';
  let slug;try{slug=new URL(profileUrl).pathname.match(/^\/in\/([^/]+)/)?.[1];}catch{}if(!slug)return {};
  const root=payload?.data || payload || {},references=Object.entries(root).filter(([k,v])=>k.startsWith('*') && typeof v==='string').map(([,v])=>v),included=Array.isArray(payload?.included)?payload.included:[];
  const belongs=node=>!node.publicIdentifier || node.publicIdentifier.toLowerCase()===slug.toLowerCase();
  const nodes=[root,...included.filter(node=>/ContactInfo/i.test(node.$type || '') && (references.includes(node.entityUrn) || profileUrn && [node.profileUrn,node['*profile']].includes(profileUrn) || String(node.entityUrn || '').toLowerCase().includes(`:${slug.toLowerCase()}`)))].filter(belongs);
  const emails=[...new Set(nodes.map(node=>address(node.emailAddress)).filter(Boolean))];
  if(emails.length!==1)return {};
  return {directEmail:emails[0],emailEvidence:{kind:'linkedin-contact-info',reference:profileUrl,mailboxVerified:false}};
}
function readLinkedInCompanyWebsite(payload,{companySlug,companyUrn=''}={}){
  const pending=[payload],nodes=[];let visited=0;
  while(pending.length && visited++<8000){const node=pending.pop();if(!node || typeof node!=='object')continue;nodes.push(node);for(const v of Object.values(node).slice(0,100))if(v && typeof v==='object')pending.push(v);}
  const same=node=>String(node.universalName || '').toLowerCase()===String(companySlug || '').toLowerCase() && companySlug || companyUrn && node.entityUrn===companyUrn;
  const candidates=nodes.filter(same),websites=[...new Set(candidates.map(n=>n.websiteUrl || n.companyPageUrl || n.website).filter(v=>typeof v==='string'))];
  if(websites.length!==1)return {};
  try{const url=new URL(websites[0]);if(!/^https?:$/.test(url.protocol) || url.username || url.password || url.port || /(^|\.)(linkedin\.com|licdn\.com|localhost)$/.test(url.hostname) || !/\.[a-z]{2,}$/i.test(url.hostname))return {};return {verifiedCompanyDomain:url.hostname.replace(/^www\./,''),companyWebsite:url.href,companyLinkedinUrl:`https://www.linkedin.com/company/${encodeURIComponent(companySlug)}/`,domainEvidence:{kind:'linkedin-company-website',reference:`https://www.linkedin.com/company/${encodeURIComponent(companySlug)}/about/`,website:url.href,mailboxVerified:false}};}catch{return {};}
}
const companyWebsiteCache=globalThis.VeloceLinkedIn?.companyWebsiteCache || new Map();
async function enrichLinkedInContext(data,{includeContactInfo=false}={}){
  const initial=location.href,profile=data.profiles?.[0],slug=location.pathname.match(/^\/in\/([^/]+)(?:\/overlay\/contact-info)?\/?$/)?.[1];
  const explicitCompany=data.companyLinkedinUrl || profile?.companyLinkedinUrl || (location.pathname.startsWith('/company/')?location.href:'');
  let companySlug='';try{const link=new URL(explicitCompany);if(/(^|\.)linkedin\.com$/.test(link.hostname))companySlug=link.pathname.match(/^\/company\/([^/]+)/)?.[1] || '';}catch{}
  const companyTask=(async()=>{
    if(!companySlug)return {};
    const cached=companyWebsiteCache.get(companySlug);if(cached && Date.now()-cached.at<900000)return cached.value;
    const url=new URL('/voyager/api/organization/companies',location.origin);url.search=new URLSearchParams({q:'universalName',universalName:companySlug,decorationId:'com.linkedin.voyager.deco.organization.web.WebFullCompanyMain-35'});
    const json=await fetchLinkedInVoyagerJson(url.href),found=readLinkedInCompanyWebsite(json,{companySlug,companyUrn:data.companyUrn || profile?.companyUrn});
    if(found.verifiedCompanyDomain){companyWebsiteCache.set(companySlug,{at:Date.now(),value:found});return found;}
    // Read the company Website field, not arbitrary links or a guessed hostname.
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),1800);
    try{const response=await fetch(`${location.origin}/company/${encodeURIComponent(companySlug)}/about/`,{credentials:'same-origin',redirect:'error',signal:controller.signal});if(!response.ok)return {};const raw=await response.text();if(raw.length>1500000)return {};const doc=new DOMParser().parseFromString(raw,'text/html');
      const heading=[...doc.querySelectorAll('dt,h3,h2')].find(el=>/^Website$/i.test(el.textContent.trim())),next=heading?.nextElementSibling,anchor=next?.matches('a[href]')?next:next?.querySelector('a[href]');let website=anchor?.getAttribute('href');
      if(!website)return {};const link=new URL(website,location.origin);if(/(^|\.)linkedin\.com$/.test(link.hostname) && link.pathname.includes('/redir/'))website=link.searchParams.get('url') || '';
      const value=readLinkedInCompanyWebsite({universalName:companySlug,websiteUrl:website},{companySlug});if(value.verifiedCompanyDomain)companyWebsiteCache.set(companySlug,{at:Date.now(),value});return value;
    }catch{return {};}finally{clearTimeout(timer);}
  })();
  const contactTask=includeContactInfo && slug && data.profiles?.length===1?fetchLinkedInVoyagerJson(`/voyager/api/identity/profiles/${encodeURIComponent(decodeURIComponent(slug))}/profileContactInfo`).then(payload=>readLinkedInContactInfo(payload,{profileUrl:profile.linkedinUrl,profileUrn:profile.profileUrn})):Promise.resolve({});
  const settled=await Promise.allSettled([companyTask,contactTask]);
  if(location.href!==initial)throw Error('The LinkedIn page changed during lookup. Retry on the new profile.');
  const company=settled[0].status==='fulfilled'?settled[0].value:{},contact=settled[1].status==='fulfilled'?settled[1].value:{};
  return {...data,...company,profiles:data.profiles?.map((p,i)=>i===0?{...p,...contact}:p)};
}

function extractLinkedInProfile() {
  // Explicit popup action on the user's current authenticated profile tab.
  if(!/(^|\.)linkedin\.com$/.test(location.hostname) || !location.pathname.startsWith('/in/'))throw Error('Open your own linkedin.com/in/ profile.');
  const clean=el=>[...new Set(String(el?.innerText || el?.textContent || '').split('\n').map(s=>s.trim()).filter(Boolean))].join('\n');
  const section=(id,title)=>document.getElementById(id)?.closest('section') || [...document.querySelectorAll('section')].find(s=>new RegExp(`^${title}$`,'i').test(s.querySelector('h2')?.textContent.trim() || ''));
  const fullName=clean(document.querySelector('h1')).slice(0,200);
  if(!fullName)throw Error('The profile header is not loaded. Open the profile and try again.');
  const header=document.querySelector('h1')?.closest('section'),headline=clean(header?.querySelector('.text-body-medium')).slice(0,300);
  const sections=[['about','About'],['experience','Experience'],['education','Education'],['skills','Skills'],['licenses_and_certifications','Certifications'],['languages','Languages']];
  const text=[fullName,headline,...sections.flatMap(([id,title])=>{const content=clean(section(id,title));return content ? [title,content] : [];})].join('\n').slice(0,60000);
  return {url:`${location.origin}${location.pathname}`,profile:{personal:{fullName},links:{linkedinUrl:`${location.origin}${location.pathname}`},summary:{headline}},text};
}

globalThis.VeloceLinkedIn=Object.freeze({version:'0.12.0',extractLinkedInCompanyPeople,extractLinkedInProspect,extractLinkedInProfile,getLinkedInCsrfToken,fetchLinkedInVoyagerJson,readLinkedInContactInfo,readLinkedInCompanyWebsite,enrichLinkedInContext,companyWebsiteCache});
})();
