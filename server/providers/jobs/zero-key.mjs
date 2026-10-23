import {remoteJSON} from '../http.mjs';
import {withDeadline,boundedFetcher} from '../deadline.mjs';
import {fail,hash,now,safeUrl,stripHtml,text} from '../../domain.mjs';
export const EXTRA_ATS=['Rippling','Pinpoint','BreezyHR','BambooHR','Personio'];
const iso=v=>v && Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const label=v=>typeof v==='string'?v:v?.name || v?.label || v?.city || '';
export function extraBoardURL(source,slug) {
  if(!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(slug || ''))return '';
  return source==='Rippling'?`https://ats.rippling.com/${slug}/jobs`:({Pinpoint:`https://${slug}.pinpointhq.com`,BreezyHR:`https://${slug}.breezy.hr`,BambooHR:`https://${slug}.bamboohr.com/careers`,Personio:`https://${slug}.jobs.personio.de`})[source] || '';
}
export function extraBoardFromURL(url) {
  const host=new URL(url).hostname,providers={'pinpointhq.com':'Pinpoint','breezy.hr':'BreezyHR','bamboohr.com':'BambooHR','jobs.personio.de':'Personio'};
  for(const [suffix,source] of Object.entries(providers)){const m=host.match(new RegExp(`^([a-z0-9_-]+)\\.${suffix.replaceAll('.','\\.')}$`,'i'));if(m && extraBoardURL(source,m[1]))return {source,slug:m[1]};}
  if(host==='ats.rippling.com'){const slug=new URL(url).pathname.split('/').filter(Boolean)[0];if(extraBoardURL('Rippling',slug))return {source:'Rippling',slug};}
  return null;
}
export function parseExtraATS(source,board,data) {
  const rows=Array.isArray(data)?data:source==='Pinpoint'?data.data:source==='BambooHR'?data.result || data.jobs:data.jobs || data.data;
  if(!Array.isArray(rows))fail(`${source} returned no readable public job list.`,502);
  const base=extraBoardURL(source,board);if(!base)fail('Use a valid public board slug.');
  return rows.slice(0,1500).map(raw=>{
    const j={...raw,...raw.attributes},jobId=j.uuid || j.id || j._id,title=j.title || j.name || j.job_title || j.jobOpeningName;
    const location=label(j.workLocation || j.location || j.office) || [j.city,j.state,j.country].filter(Boolean).join(', ');
    const description=stripHtml([j.description || j.description_html || j.content,j.key_responsibilities,j.skills_knowledge_expertise].filter(Boolean).join('\n'));
    let url=j.url || j.job_url || j.position_url || j.absolute_url || j.application_url;
    if(!url && jobId)url=source==='Pinpoint'?`${base}/en/postings/${jobId}`:source==='BreezyHR'?`${base}/p/${jobId}`:source==='BambooHR'?`${base}/careers/${jobId}`:source==='Personio'?`${base}/job/${jobId}`:'';
    const safe=safeUrl(url);if(!jobId || !title || !safe)return null;
    const target=new URL(safe),expected=new URL(base);
    if(target.hostname!==expected.hostname || source==='Rippling' && target.pathname.split('/').filter(Boolean)[0]!==board)return null;
    return {id:`${source.toLowerCase()}-${hash(board).slice(0,8)}-${jobId}`,title:text(title,200),company:text(label(j.company || data.company || data.organization) || board,150),location:text(location,250) || 'Not listed',workMode:j.remote===true || /remote/i.test(`${location} ${j.workplace_type || ''}`)?'Remote':/hybrid/i.test(`${location} ${j.workplace_type || ''}`)?'Hybrid':'On-site',url:safe,description:text(description,30000),descriptionUnavailable:!description,indexedSnippet:!description,sourceNote:!description?'Public board listing. Open the source for full requirements.':undefined,category:label(j.department) || j.departmentLabel || 'Other',tags:[label(j.department) || j.departmentLabel].filter(Boolean),salary:typeof j.salary==='string'?j.salary:'Not listed',type:label(j.employment_type || j.type) || 'Not listed',publishedAt:iso(j.published_at || j.published_date || j.created_at),source,board,isDemo:false,archived:false,fetchedAt:now()};
  }).filter(Boolean);
}
export function parsePersonioXML(xml,board) {
  if(typeof xml!=='string' || xml.length>3000000 || /<!DOCTYPE|<!ENTITY/i.test(xml))fail('Unsupported Personio XML feed.',502);
  const value=(part,name)=>{const raw=part.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'))?.[1] || '';return stripHtml(raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')).trim();};
  if(!/<workzag-jobs|<positions/i.test(xml))fail('Personio returned no readable public XML feed.',502);
  const rows=[...xml.matchAll(/<position(?:\s[^>]*)?>([\s\S]*?)<\/position>/gi)].slice(0,1500).map(([,part])=>({id:value(part,'id'),title:value(part,'name'),office:value(part,'office'),department:value(part,'department'),employment_type:value(part,'employmentType'),description:[...part.matchAll(/<jobDescription(?:\s[^>]*)?>([\s\S]*?)<\/jobDescription>/gi)].map(([,s])=>[value(s,'name'),value(s,'value')].join('\n')).join('\n'),created_at:value(part,'createdAt')}));
  return parseExtraATS('Personio',board,rows);
}
export async function fetchExtraATS(source,board,fetcher=fetch) {
  const base=extraBoardURL(source,board);if(!base)fail('Use a valid public board slug.');
  return withDeadline(async signal=>{
    const load=boundedFetcher(fetcher,signal);
    if(source==='Personio') {
      const response=await load(`${base}/xml`,{headers:{Accept:'application/xml'},redirect:'error'});if(!response.ok){await response.body?.cancel();fail(`Personio public feed returned HTTP ${response.status}.`,502);}
      const reader=response.body?.getReader(),parts=[];let size=0;
      if(!reader)return parsePersonioXML(await response.text(),board);
      for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>3000000){await reader.cancel();fail('Personio feed exceeded the size limit.',502);}parts.push(value);}
      return parsePersonioXML(Buffer.concat(parts).toString(),board);
    }
    const url=source==='Rippling'?`https://api.rippling.com/platform/api/ats/v1/board/${board}/jobs`:source==='Pinpoint'?`${base}/postings.json`:source==='BreezyHR'?`${base}/json`:`https://${board}.bamboohr.com/careers/list`;
    return parseExtraATS(source,board,await remoteJSON(url,{},load,6500));
  },7500);
}
export function parseHNThread(data) {
  if(!Array.isArray(data.children))fail('Hacker News returned no readable thread.',502);
  return data.children.filter(c=>c.text && !c.deleted && !c.dead).slice(0,1000).map(c=>{
    const body=stripHtml(c.text),line=body.split('\n').map(s=>s.trim()).find(Boolean) || '',parts=line.split('|').map(s=>s.trim());
    if(parts.length<2 || /who wants to be hired|freelancer seeking|seeking work|looking for (?:a job|work)/i.test(line))return null;
    const company=text(parts[0].replace(/\[.*?\]|https?:\/\/\S+/g,'').trim(),150),role=parts.find((p,i)=>i>0 && /engineer|develop|analyst|design|product|manager|sales|research|account|finance|scientist|recruit|operations|roles|hiring/i.test(p));
    if(!company || !role || !c.id)return null;
    const location=parts.find((p,i)=>i>0 && p!==role && !/https?:|full.time|part.time|salary|equity|\$|£|€|visa/i.test(p)) || 'Not listed';
    const url=`https://news.ycombinator.com/item?id=${encodeURIComponent(c.id)}`;
    const emails=[...new Set(body.match(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi) || [])].slice(0,3);
    return {id:`hn-${c.id}`,company,title:text(role,200),location:text(location,250),workMode:/remote/i.test(line)?'Remote':/hybrid/i.test(line)?'Hybrid':'On-site',description:text(body,18000),url,source:'Hacker News',board:String(data.id),publishedAt:iso(c.created_at),type:/full.time/i.test(line)?'Full-time':'Not listed',salary:'Not listed',category:'Other',tags:[],publicHiringEmails:emails.map(email=>({email,sourceUrl:url,status:'unverified'})),isDemo:false,archived:false,fetchedAt:now()};
  }).filter(Boolean);
}
export async function fetchHNHiring(fetcher=fetch) {
  return withDeadline(async signal=>{
    const load=boundedFetcher(fetcher,signal),url=new URL('https://hn.algolia.com/api/v1/search_by_date');url.search=new URLSearchParams({tags:'story,author_whoishiring',query:'Ask HN: Who is hiring?',hitsPerPage:'5'});
    const data=await remoteJSON(url.href,{},load,7000),thread=data.hits?.find(h=>/^Ask HN: Who is hiring\?/i.test(h.title || '') && /^\d+$/.test(h.objectID) && Date.parse(h.created_at)>Date.now()-70*86400000);
    if(!thread)fail('No recent monthly Hacker News hiring thread was available.',422);
    return parseHNThread(await remoteJSON(`https://hn.algolia.com/api/v1/items/${thread.objectID}`,{},load,10000));
  },14000);
}
