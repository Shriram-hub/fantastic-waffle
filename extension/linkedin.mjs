export function extractLinkedInCompanyPeople() {
  if(!/(^|\.)linkedin\.com$/.test(location.hostname) || !/^\/(company\/|jobs\/view\/)/.test(location.pathname))throw Error('Open a LinkedIn company people page or job listing.');
  const clean=el=>String(el?.innerText || el?.textContent || '').split('\n').map(s=>s.trim()).filter(Boolean).filter((s,i,a)=>a.indexOf(s)===i).join(' ').slice(0,300);
  const company=clean(document.querySelector('[data-testid="job-details-company-name"],.job-details-jobs-unified-top-card__company-name,.jobs-unified-top-card__company-name,.org-top-card-summary__title')) || (location.pathname.startsWith('/company/') ? clean(document.querySelector('h1')) : '');
  const people=[];
  for(const a of document.querySelectorAll('a[href*="/in/"]')) {
    const card=a.closest('li,.org-people-profile-card,.artdeco-card,[data-view-name="profile-component-entity"]') || a.parentElement;
    if(card?.closest('[hidden],[aria-hidden="true"]') || getComputedStyle(card).display==='none' || getComputedStyle(card).visibility==='hidden')continue;
    let u;try{u=new URL(a.href);if(!/(^|\.)linkedin\.com$/.test(u.hostname) || !u.pathname.startsWith('/in/'))continue;}catch{continue;}
    const name=clean(a.querySelector('span[aria-hidden="true"],.artdeco-entity-lockup__title') || a).replace(/\s*[·•].*$/,'').trim(),title=clean(card.querySelector('.artdeco-entity-lockup__subtitle,.lt-line-clamp--multi-line,.t-14.t-black--light')) || clean(card).replace(name,'').trim();
    if(!/recruit|talent|human resources|\bhr\b|hiring|manager|director|chief|founder|partner|vice president|head of/i.test(title) || name.split(/\s+/).length<2 || people.some(p=>p.linkedinUrl===u.origin+u.pathname))continue;
    people.push({name,title,linkedinUrl:u.origin+u.pathname});if(people.length>=25)break;
  }
  if(!company || !people.length)throw Error('No visible company recruiters were found. Open the company People page, load the relevant profiles, and try again.');
  return {company,profiles:people,sourceUrl:location.origin+location.pathname};
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
