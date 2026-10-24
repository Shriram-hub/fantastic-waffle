import {remoteJSON} from '../http.mjs';
import {fail,now,safeUrl,stripHtml,text} from '../../domain.mjs';

export function normalizeMuse(data) {
  if(!Array.isArray(data.results))fail('The Muse returned an unexpected response.',502);
  return data.results.filter(j=>j.id && j.name && safeUrl(j.refs?.landing_page)).map(j=>({id:`muse-${j.id}`,title:j.name,company:j.company?.name || 'Company not listed',location:(j.locations || []).map(l=>l.name).join(', ') || 'Not listed',workMode:(j.locations || []).some(l=>/remote|flexible/i.test(l.name))?'Remote':'On-site',description:stripHtml(j.contents),url:safeUrl(j.refs.landing_page),publishedAt:j.publication_date || null,category:j.categories?.[0]?.name || 'Other',tags:(j.categories || []).map(c=>c.name),type:j.levels?.[0]?.name || 'Not listed',salary:'Not listed',attribution:'The Muse'}));
}
export async function fetchPublicFeed(source,fetcher=fetch,config={},query='') {
  let jobs;
  if(source==='The Muse') {
    const url=new URL('https://www.themuse.com/api/public/jobs');
    const category=/financ|account|bank|valuation/i.test(query)?'Accounting and Finance':/consult|strategy|operation/i.test(query)?'Business Operations':/data|analytics/i.test(query)?'Data and Analytics':/design|product/i.test(query)?'Product Management':/market|sales/i.test(query)?'Marketing':'Software Engineering';
    url.search=new URLSearchParams({category,page:String(Math.max(0,Number(config.ATS_PAGE || 1)-1)),...(config.SEARCH_LOCATION?{location:text(config.SEARCH_LOCATION,150)}:{}),...(config.MUSE_API_KEY?{api_key:config.MUSE_API_KEY}:{})});
    jobs=normalizeMuse(await remoteJSON(url.href,{},fetcher,7000));
  } else if(source==='Remote OK') {
    const data=await remoteJSON('https://remoteok.com/api',{},fetcher);
    if(!Array.isArray(data)) fail('Remote OK returned an unexpected response.',502);
    jobs=data.filter(j=>j.id && j.position && safeUrl(j.url)).slice(0,200).map(j=>({
      id:`remoteok-${j.id}`,company:j.company,title:j.position,location:j.location || 'Remote',workMode:'Remote',salary:j.salary_min ? `$${j.salary_min} – $${j.salary_max || j.salary_min}` : 'Not listed',
      description:stripHtml(stripHtml(j.description)),tags:j.tags || [],category:'Other',type:'Not listed',url:safeUrl(j.url),publishedAt:j.date || null,attribution:'Remote OK',
    }));
  } else {
    const data=await remoteJSON('https://jobicy.com/api/v2/remote-jobs?count=200',{},fetcher);
    if(!Array.isArray(data.jobs)) fail('Jobicy returned an unexpected response.',502);
    jobs=data.jobs.filter(j=>j.id && j.jobTitle && safeUrl(j.url)).slice(0,200).map(j=>({
      id:`jobicy-${j.id}`,company:j.companyName,companyLogo:safeUrl(j.companyLogo),title:stripHtml(j.jobTitle),location:j.jobGeo || 'Remote',workMode:'Remote',salary:j.annualSalaryMin ? `${j.salaryCurrency || ''} ${j.annualSalaryMin} – ${j.annualSalaryMax || j.annualSalaryMin}` : 'Not listed',
      description:stripHtml(j.jobDescription || j.jobExcerpt),tags:j.jobIndustry || [],category:j.jobIndustry?.[0] || 'Other',type:j.jobType?.join(', ') || 'Not listed',url:safeUrl(j.url),publishedAt:j.pubDate || null,attribution:'Jobicy',
    }));
  }
  return jobs.map(j=>({...j,company:text(j.company,150),title:text(j.title,200),description:text(j.description,8000),source,board:'',isDemo:false,archived:false,fetchedAt:now()}));
}
