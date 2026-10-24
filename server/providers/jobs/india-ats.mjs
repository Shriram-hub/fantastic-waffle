import {remoteJSON} from '../http.mjs';
import {withDeadline,boundedFetcher} from '../deadline.mjs';
import {fail,hash,now,safeUrl,stripHtml,text} from '../../domain.mjs';
import {crawlCareerPage} from './career-pages.mjs';
export const INDIA_ATS=['Keka','Darwinbox','Freshteam','Zoho Recruit'];
export function indiaBoard(source,value) {
  try {
    const host=source==='Keka'?'keka.com':source==='Darwinbox'?'darwinbox.in':source==='Freshteam'?'freshteam.com':'zohorecruit.com';
    const url=new URL(/^https:\/\//i.test(value)?value:`https://${value}.${host}${source==='Keka'?'/careers':''}`);
    const pattern=source==='Darwinbox'?/^[a-z0-9-]+\.darwinbox\.(in|com)$/i:source==='Keka'?/^[a-z0-9-]+\.keka\.com$/i:source==='Freshteam'?/^[a-z0-9-]+\.freshteam\.com$/i:/^[a-z0-9-]+\.(?:zohorecruit\.(?:com|eu|in)|zohopublic\.com)$/i;
    if(url.protocol!=='https:' || url.username || url.password || url.port || !pattern.test(url.hostname))return null;
    const portal=source==='Keka'?url.pathname.split('/').filter(Boolean)[1] || 'default':null;if(portal && !/^[\w-]{1,80}$/.test(portal))return null;
    return {origin:url.origin,host:url.hostname,portal,url:source==='Keka'?`${url.origin}/careers${portal==='default'?'':`/${portal}`}`:source==='Darwinbox'?`${url.origin}/ms/candidate/careers`:source==='Freshteam'?`${url.origin}/jobs`:url.href};
  }catch{return null;}
}
export function normalizeIndiaATS(source,board,data) {
  const tenant=indiaBoard(source,board);if(!tenant)fail('Use a supported public career board URL.');
  const rows=Array.isArray(data)?data:Array.isArray(data.jobs)?data.jobs:Array.isArray(data.data)?data.data:null;
  if(!rows)fail(`${source} returned an unsupported public response.`,502);
  return rows.flatMap(j=>{
    const code=j.id || j.jobId || j.job_id,title=j.title || j.designation_display_name || j.designation_name || j.job_title;
    const url=safeUrl(j.url || j.jobUrl || j.job_url || j.job_posting_url || j.applyUrl || j.apply_url || (source==='Keka'?`${tenant.url}/jobdetails/${code}`:source==='Freshteam'?`${tenant.origin}/jobs/${code}`:source==='Darwinbox'?`${tenant.origin}/ms/candidate/careers/${code}`:''));
    if(!code || !title || !url)return [];
    const locations=j.jobLocations || j.locations || [j.location_name || j.location || j.city || 'Not listed'];
    const location=Array.isArray(locations)?locations.map(l=>typeof l==='string'?l:[l.name || l.city,l.state,l.countryName || l.country].filter(Boolean).join(', ')).join(' / '):typeof locations==='string'?locations:[locations.city,locations.country].filter(Boolean).join(', ');
    const rawDate=j.publishedAt || j.publishedOn || j.posted_date || j.created_at || j.date_posted || j.posted_on || j.created_on;
    return [{id:`${source.toLowerCase().replaceAll(' ','')}-${hash([tenant.host,code]).slice(0,32)}`,title:text(title,200),company:text(j.company_name || j.companyName || j.organization || tenant.host.split('.')[0],150),source,board,url,location:text(location,250),workMode:(j.is_remote===true || j.is_remote===1 || j.is_remote==='1') || /remote/i.test(location)?'Remote':/hybrid/i.test(location)?'Hybrid':'On-site',description:text(stripHtml(j.description || j.jobDescription || j.job_description || j.description_html || j.jd),10000),publishedAt:Number.isFinite(Date.parse(rawDate))?new Date(rawDate).toISOString():null,tags:(j.skills || j.skillNames || []).slice?.(0,15).filter?.(v=>typeof v==='string') || [],salary:'Not listed',type:j.emp_type_name || j.employment_type || 'Not listed',isDemo:false,archived:false,fetchedAt:now()}];
  });
}
export async function fetchIndiaATS(source,board,config={},fetcher=fetch) {
  const tenant=indiaBoard(source,board);if(!tenant)fail('Use a supported public ATS career URL.');
  if(source==='Zoho Recruit')return (await crawlCareerPage(tenant.url,config.CAREER_PAGE_LOADER?{load:config.CAREER_PAGE_LOADER}:{})).jobs.map(j=>({...j,source,board}));
  return withDeadline(async signal=>{
    const bounded=boundedFetcher(fetcher,signal),page=Math.max(1,Math.min(500,Number(config.ATS_PAGE)||1));let data,size;
    if(source==='Keka') {
      const response=await bounded(tenant.url,{redirect:'error',headers:{Accept:'text/html','User-Agent':'Veloce/1.0'}});if(!response.ok){await response.body?.cancel();fail(`Keka public board returned HTTP ${response.status}.`,502);}
      const html=await response.text();if(html.length>1000000)fail('Keka public page is too large.',502);
      const identifier=html.match(/\/(?:ats\/documents|careers\/api\/embedjobs\/js)\/([0-9a-f-]{36})\//i)?.[1] || html.match(/\/careers\/api\/embedjobs\/js\/([0-9a-f-]{36})/i)?.[1];
      if(!identifier)fail('Keka did not publish a supported public career identifier. Open the company career page.',422);
      data=await remoteJSON(`${tenant.origin}/careers/api/embedjobs/${tenant.portal}/active/${identifier}`,{},bounded,7000);
    }else if(source==='Darwinbox') {
      data=await remoteJSON(`${tenant.origin}/ms/candidateapi/job/alljobs?companyId=main`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId:'main',page,sort_option:'new',limit:10})},bounded,7000);size=10;
      if(data.status && data.status!=='success')fail('Darwinbox public access is unavailable. Other sources continue.',422);
    }else {data=await remoteJSON(`${tenant.origin}/hire/widgets/jobs.json`,{},bounded,7000);}
    const jobs=normalizeIndiaATS(source,board,data);
    if(size)Object.defineProperty(jobs,'pagination',{value:{page,hasMore:page<500 && jobs.length===size && (!Number.isFinite(Number(data.job_counts)) || page*size<Number(data.job_counts)),nextPage:page+1}});
    return jobs;
  },10000);
}
