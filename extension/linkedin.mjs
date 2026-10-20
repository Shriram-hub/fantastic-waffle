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
