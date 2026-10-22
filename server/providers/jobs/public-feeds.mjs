import {remoteJSON} from '../http.mjs';
import {fail,now,safeUrl,stripHtml,text} from '../../domain.mjs';

export async function fetchPublicFeed(source,fetcher=fetch) {
  let jobs;
  if(source==='Remote OK') {
    const data=await remoteJSON('https://remoteok.com/api',{},fetcher);
    if(!Array.isArray(data)) fail('Remote OK returned an unexpected response.',502);
    jobs=data.filter(j=>j.id && j.position && safeUrl(j.url)).slice(0,200).map(j=>({
      id:`remoteok-${j.id}`,company:j.company,title:j.position,location:j.location || 'Remote',workMode:'Remote',salary:j.salary_min ? `$${j.salary_min} – $${j.salary_max || j.salary_min}` : 'Not listed',
      description:stripHtml(stripHtml(j.description)),tags:j.tags || [],category:'Other',type:'Not listed',url:safeUrl(j.url),publishedAt:j.date || now(),attribution:'Remote OK',
    }));
  } else {
    const data=await remoteJSON('https://jobicy.com/api/v2/remote-jobs?count=200',{},fetcher);
    if(!Array.isArray(data.jobs)) fail('Jobicy returned an unexpected response.',502);
    jobs=data.jobs.filter(j=>j.id && j.jobTitle && safeUrl(j.url)).slice(0,200).map(j=>({
      id:`jobicy-${j.id}`,company:j.companyName,companyLogo:safeUrl(j.companyLogo),title:stripHtml(j.jobTitle),location:j.jobGeo || 'Remote',workMode:'Remote',salary:j.annualSalaryMin ? `${j.salaryCurrency || ''} ${j.annualSalaryMin} – ${j.annualSalaryMax || j.annualSalaryMin}` : 'Not listed',
      description:stripHtml(j.jobDescription || j.jobExcerpt),tags:j.jobIndustry || [],category:j.jobIndustry?.[0] || 'Other',type:j.jobType?.join(', ') || 'Not listed',url:safeUrl(j.url),publishedAt:j.pubDate || now(),attribution:'Jobicy',
    }));
  }
  return jobs.map(j=>({...j,company:text(j.company,150),title:text(j.title,200),description:text(j.description,8000),source,board:'',isDemo:false,archived:false,fetchedAt:now()}));
}
