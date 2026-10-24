import {remoteJSON} from '../http.mjs';
import {hash,now,safeUrl,stripHtml,text,fail} from '../../domain.mjs';
export async function fetchEnterpriseJobs(source,role,config={},fetcher=fetch) {
  if(source!=='Amazon Jobs')fail('Unsupported enterprise source.');
  const page=Math.max(1,Math.min(500,Number(config.ATS_PAGE)||1)),url=new URL('https://www.amazon.jobs/en/search.json');
  url.search=new URLSearchParams({base_query:text(role,150),loc_query:text(config.SEARCH_LOCATION,150),result_limit:'100',offset:String((page-1)*100),sort:'recent'});
  const data=await remoteJSON(url.href,{},fetcher,8000);if(!Array.isArray(data.jobs))fail('Amazon returned an unsupported public job response.',502);
  const jobs=data.jobs.flatMap(j=>{
    const link=safeUrl(j.job_path?new URL(j.job_path,'https://www.amazon.jobs').href:j.url),code=j.id || j.id_icims;
    if(!link || !code || !j.title)return [];
    const published=j.posted_date || j.created_at;
    return [{id:`amazon-${hash(String(code)).slice(0,32)}`,title:text(j.title,200),company:'Amazon',companyDomain:'amazon.com',companyDomainSource:'provider',location:text(j.location || [j.city,j.state,j.country_code].filter(Boolean).join(', '),250),workMode:/remote/i.test(j.location || '')?'Remote':'On-site',url:link,description:text(stripHtml(j.description || j.basic_qualifications || ''),10000),source,board:role,tags:[j.job_category].filter(Boolean),salary:'Not listed',type:j.job_schedule_type || 'Not listed',publishedAt:Number.isFinite(Date.parse(published))?new Date(published).toISOString():null,isDemo:false,archived:false,fetchedAt:now()}];
  });
  Object.defineProperty(jobs,'pagination',{value:{page,hasMore:page<500 && jobs.length===100 && (!Number.isFinite(Number(data.hits)) || page*100<Number(data.hits)),nextPage:page+1}});return jobs;
}
