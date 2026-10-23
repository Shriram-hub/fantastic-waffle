// These functions are serialized by chrome.scripting.executeScript. Keep all
// DOM helpers inside the function; imported closures are unavailable there.
export function extractLinkedInCompanyPeople(options) {
  const {targetCount=100,duration=4000}=options || {};
  const initial=location.href,selectedCompany=String(options?.company || '').trim();
  if(location.pathname.startsWith('/search/') && !selectedCompany)throw Error('Enter a company and filter the LinkedIn search to that company before harvesting.');
  if(!/(^|\.)linkedin\.com$/.test(location.hostname) || !/^\/(company\/|jobs\/view\/|search\/results\/people\/?)/.test(location.pathname))throw Error('Open a LinkedIn company People page or people search.');
  const clean=el=>String(el?.innerText || el?.textContent || '').split('\n').map(s=>s.trim()).filter(Boolean).filter((s,i,a)=>a.indexOf(s)===i).join(' ').slice(0,250),people=new Map();
  const company=clean(document.querySelector('[data-testid="job-details-company-name"],.job-details-jobs-unified-top-card__company-name,.jobs-unified-top-card__company-name,.org-top-card-summary__title')) || (location.pathname.startsWith('/company/')?clean(document.querySelector('main h1,h1')):selectedCompany);
  const count=Math.min(100,Math.max(1,Number(targetCount)||100)),wait=Math.min(5000,Math.max(0,Number(duration)||0)),steps=wait?8:1,startY=window.scrollY;
  const collect=()=>{
    if(location.href!==initial)throw Error('The LinkedIn page changed. Start harvesting again on the new page.');
    if(/\/(checkpoint|authwall|login)(?:\/|$)/.test(location.pathname) || document.querySelector('iframe[src*="captcha"]'))throw Error('Complete LinkedIn verification yourself before continuing.');
    for(const a of document.querySelectorAll('main a[href*="/in/"],li a[href*="/in/"],.org-people-profile-card a[href*="/in/"],.entity-result a[href*="/in/"],div[data-view-name="profile-card"] a[href*="/in/"]')) {
      const card=a.closest('.org-people-profile-card,[data-view-name="profile-card"],.entity-result,[data-view-name="profile-component-entity"],li');
      if(location.pathname.startsWith('/search/') && !clean(card).toLowerCase().includes(selectedCompany.toLowerCase()))continue;
      if(!card || card.closest('aside,nav,header,footer') || card.closest('[hidden],[aria-hidden="true"]') || getComputedStyle(card).display==='none' || getComputedStyle(card).visibility==='hidden')continue;
      let u;try{u=new URL(a.href);if(u.protocol!=='https:' || !/(^|\.)linkedin\.com$/.test(u.hostname) || !/^\/in\/[a-z0-9_%.-]+\/?$/i.test(u.pathname))continue;}catch{continue;}
      const name=clean(a.querySelector('span[aria-hidden="true"],.artdeco-entity-lockup__title') || card.querySelector('.artdeco-entity-lockup__title,.entity-result__title-text [aria-hidden="true"]') || a).replace(/\s*[·•].*$/,'').replace(/\s+(?:View|profile).*$/i,'').trim();
      if(!/^[\p{L}][\p{L}\p{M}'’. -]+$/u.test(name) || name.split(/\s+/).length<2 || name.length>120)continue;
      const url=`https://www.linkedin.com${u.pathname.replace(/\/$/,'').toLowerCase()}`,parts=name.split(/\s+/),title=clean(card.querySelector('.artdeco-entity-lockup__subtitle,.entity-result__primary-subtitle,.lt-line-clamp--multi-line,.t-14.t-black--light')),where=clean(card.querySelector('.entity-result__secondary-subtitle,.artdeco-entity-lockup__caption,[data-anonymize="location"]'));
      if(!people.has(url))people.set(url,{firstName:parts[0],lastName:parts.at(-1),fullName:name,name,title,profileUrl:url,linkedinUrl:url,location:where});
      if(people.size>=count)break;
    }
  };
  const result=()=>{if(!people.size)throw Error('No complete visible profiles found. Load the People tab or people search and try again.');return {company,profiles:[...people.values()].slice(0,count),sourceUrl:location.origin+location.pathname};};
  // Preserve the original synchronous visible-only API for existing callers.
  if(!options){collect();return result();}
  return (async()=>{
    try{for(let step=0;step<steps;step++){collect();if(people.size>=count || step===steps-1)break;window.scrollBy({top:Math.max(window.innerHeight || 800,900),behavior:'instant'});await new Promise(resolve=>setTimeout(resolve,wait/(steps-1)));}return result();}
    finally{if(location.href===initial)window.scrollTo({top:startY,behavior:'instant'});}
  })();
}
export function extractLinkedInProspect() {
  if(!/(^|\.)linkedin\.com$/.test(location.hostname) || !/^\/in\/[^/]+\/?$/.test(location.pathname))throw Error('Open an individual LinkedIn profile to get an email.');
  const clean=el=>String(el?.innerText || el?.textContent || '').split('\n').map(s=>s.trim()).filter(Boolean).join(' ').slice(0,200),heading=document.querySelector('main h1,h1'),header=heading?.closest('section') || heading?.parentElement,name=clean(heading);
  if(!name || name.split(/\s+/).length<2)throw Error('The profile header is not loaded. Wait and try again.');
  let company=clean(header?.querySelector('button[aria-label*="Current company"],a[aria-label*="Current company"],.pv-text-details__right-panel-item-text')).replace(/^Current company:\s*/i,'');
  const experience=document.getElementById('experience')?.closest('section');
  if(!company && experience)for(const row of experience.querySelectorAll('li'))if(/\bPresent\b/.test(row.textContent)){company=clean(row.querySelector('a[href*="/company/"] [aria-hidden="true"],a[href*="/company/"]'));if(company)break;}
  const url=`https://www.linkedin.com${location.pathname.replace(/\/$/,'').toLowerCase()}`,parts=name.split(/\s+/);
  return {company,sourceUrl:url,profiles:[{name,fullName:name,firstName:parts[0],lastName:parts.at(-1),title:clean(header?.querySelector('.text-body-medium,.pv-text-details__left-panel .text-body-medium')),linkedinUrl:url,profileUrl:url,location:clean(header?.querySelector('.text-body-small.inline.t-black--light'))}]};
}
export function extractLinkedInProfile() {
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
