import {remoteJSON} from '../http.mjs';
import {fail,hash,now,safeUrl,stripHtml,text} from '../../domain.mjs';
import {withDeadline,boundedFetcher} from '../deadline.mjs';
export const PUBLIC_ATS=['SmartRecruiters','Workable','Recruitee','Lever EU','Workday'];
const iso=value=>Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const mode=value=>/remote/i.test(value)?'Remote':/hybrid/i.test(value)?'Hybrid':'On-site';
export function workdayBoard(value) {
  try {
    const u=new URL(value),host=u.hostname.match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/i),parts=u.pathname.split('/').filter(Boolean),board=parts[0]?.match(/^[a-z]{2}-[A-Z]{2}$/) ? parts[1] : parts[0];
    if(u.protocol!=='https:' || u.username || u.password || u.port || !host || !/^[\w-]{1,100}$/.test(board || ''))return null;
    return {tenant:host[1],instance:host[2],board,origin:u.origin,url:`${u.origin}/${board}`};
  }catch{return null;}
}
export function normalizePublicATS(source,board,data) {
  let jobs;
  if(source==='SmartRecruiters') {
    if(!Array.isArray(data.content))fail('SmartRecruiters returned an unexpected response.',502);
    jobs=data.content.map(j=>({id:j.id,title:j.name,company:j.company?.name || board,location:[j.location?.city,j.location?.region,j.location?.country].filter(Boolean).join(', '),description:stripHtml(Object.values(j.jobAd?.sections || {}).map(s=>s.text || '').join('\n')),category:j.department?.label,department:j.department?.label,type:j.typeOfEmployment?.label,url:j.jobAdUrl || `https://jobs.smartrecruiters.com/${encodeURIComponent(board)}/${encodeURIComponent(j.id)}`,publishedAt:iso(j.releasedDate),remote:j.location?.remote}));
  } else if(source==='Workable') {
    if(!Array.isArray(data.jobs))fail('Workable returned an unexpected response.',502);
    jobs=data.jobs.map(j=>({id:j.shortcode || j.id,title:j.title,company:data.name || board,location:typeof j.location==='string'?j.location:[j.location?.city,j.location?.country].filter(Boolean).join(', '),description:stripHtml(j.description),department:j.department,category:j.department,type:j.employment_type,url:j.url || j.application_url || `https://apply.workable.com/${board}/j/${j.shortcode}/`,publishedAt:iso(j.published_on || j.created_at),remote:j.telecommuting || j.location?.telecommuting}));
  } else if(source==='Recruitee') {
    if(!Array.isArray(data.offers))fail('Recruitee returned an unexpected response.',502);
    jobs=data.offers.map(j=>({id:j.id,title:j.title,company:data.company?.name || board,location:j.location || [j.city,j.country].filter(Boolean).join(', '),description:stripHtml([j.description,j.requirements].filter(Boolean).join('\n')),category:j.department,department:j.department,type:j.employment_type_code,url:j.careers_url || `https://${board}.recruitee.com/o/${j.slug}`,publishedAt:iso(j.published_at || j.created_at),remote:j.remote,expiresAt:iso(j.expires_at)}));
  } else if(source==='Workday') {
    const tenant=workdayBoard(board);if(!tenant || !Array.isArray(data.jobPostings))fail('Workday returned an unexpected public board response.',502);
    jobs=data.jobPostings.map(j=>({id:hash([tenant.url,j.externalPath]),title:j.title,company:tenant.tenant,location:j.locationsText,description:stripHtml(j.jobDescription || ''),type:'Not listed',url:j.externalPath?`${tenant.origin}/${tenant.board}${j.externalPath}`:'',publishedAt:iso(j.datePosted),postedLabel:text(j.postedOn,80),descriptionUnavailable:!j.jobDescription,indexedSnippet:!j.jobDescription,sourceNote:'Public Workday search result. Open listing for full requirements.'}));
  } else fail('Unsupported public ATS.');
  return jobs.filter(j=>j.id && j.title && safeUrl(j.url)).map(j=>({...j,id:`${source.toLowerCase().replaceAll(' ','')}-${hash(board).slice(0,10)}-${j.id}`,title:text(j.title,200),company:text(j.company,150),url:safeUrl(j.url),location:text(j.location,250) || 'Not listed',workMode:j.remote?'Remote':mode(j.location || ''),description:text(j.description,30000),tags:[j.department].filter(v=>typeof v==='string'),category:text(j.category,150) || 'Other',salary:'Not listed',type:j.type || 'Not listed',source,board,isDemo:false,archived:false,fetchedAt:now()}));
}
export async function fetchPublicATS(source,board,config={},fetcher=fetch,query='') {
  if(source!=='Workday' && !/^[\w-]{1,80}$/.test(board))fail('Enter a valid public ATS board slug.');
  return withDeadline(async signal=>{
    const load=(url,options={})=>remoteJSON(url,options,boundedFetcher(fetcher,signal),6000);
    if(source==='Workable')return normalizePublicATS(source,board,await load(`https://apply.workable.com/api/v1/widget/accounts/${board}`));
    if(source==='Recruitee')return normalizePublicATS(source,board,await load(`https://${board}.recruitee.com/api/offers/`));
    const page=Math.max(1,Math.min(20,Number(config.ATS_PAGE) || 1));
    if(source==='SmartRecruiters') {
      const u=new URL(`https://api.smartrecruiters.com/v1/companies/${board}/postings`);u.search=new URLSearchParams({limit:'100',offset:String((page-1)*100),...(query?{q:text(query,120)}:{})});
      return normalizePublicATS(source,board,await load(u.href));
    }
    const tenant=workdayBoard(board);if(!tenant)fail('Use a public Workday tenant board URL.');
    return normalizePublicATS(source,board,await load(`${tenant.origin}/wday/cxs/${tenant.tenant}/${tenant.board}/jobs`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({limit:20,offset:(page-1)*20,searchText:text(query,150),appliedFacets:{}})}));
  },7000);
}
