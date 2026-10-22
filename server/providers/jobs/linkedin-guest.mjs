import {withDeadline,boundedFetcher} from '../deadline.mjs';
import {fail,hash,now,safeUrl,stripHtml,text} from '../../domain.mjs';

const decode=s=>String(s || '').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Math.min(0x10ffff,Number(n))));
const attribute=(html,name)=>decode(html.match(new RegExp(`\\b${name}=["']([^"']*)["']`,'i'))?.[1] || '');
const cardText=(html,cls)=>text(stripHtml(html.match(new RegExp(`<[^>]+class=["'][^"']*${cls}[^"']*["'][^>]*>([\\s\\S]*?)<\\/`,'i'))?.[1] || ''),300).trim();

export function parseLinkedInCards(html,query='') {
  const cards=String(html).match(/<li\b[^>]*>[\s\S]*?<\/li>/gi) || [];
  const result=new Map();
  for(const card of cards) {
    const link=(card.match(/<a\b[^>]*>/gi) || []).find(a=>/base-card__full-link|base-search-card__full-link/.test(a));
    const url=safeUrl(attribute(link || '','href'));
    if(!url) continue;
    const parsed=new URL(url);
    if(!/(^|\.)linkedin\.com$/.test(parsed.hostname) || !parsed.pathname.startsWith('/jobs/view/')) continue;
    parsed.search='';parsed.hash='';
    const title=cardText(card,'base-search-card__title'),company=cardText(card,'base-search-card__subtitle'),location=cardText(card,'job-search-card__location');
    if(!title || !company) continue;
    const published=attribute(card.match(/<time\b[^>]*>/i)?.[0] || '','datetime');
    const job={id:`linkedin-${hash(parsed.href).slice(0,32)}`,title,company,location:location || 'Not listed',workMode:/remote/i.test(location) ? 'Remote' : /hybrid/i.test(location) ? 'Hybrid' : 'On-site',url:parsed.href,description:'',descriptionUnavailable:true,source:'LinkedIn Guest',board:query,tags:[],salary:'Not listed',type:'Not listed',category:'Other',publishedAt:Number.isFinite(Date.parse(published)) ? new Date(published).toISOString() : null,fetchedAt:now(),isDemo:false,archived:false};
    const poster=(card.match(/<a\b[^>]*>/gi) || []).find(a=>/job-poster__|data-job-poster-name/i.test(a)),posterName=attribute(poster || '','data-job-poster-name'),posterURL=safeUrl(attribute(poster || '','href'));
    if(posterName && /^https:\/\/(?:[a-z]+\.)?linkedin\.com\/in\//i.test(posterURL || ''))job.postedBy={name:text(posterName,150),url:posterURL,quote:'Posting author supplied on public job card'};
    result.set(job.id,job);
  }
  return [...result.values()].slice(0,100);
}

export async function fetchLinkedInGuest(query,config={},fetcher=fetch) {
  if(!String(query || '').trim()) return [];
  const freshness=config.LINKEDIN_FRESHNESS || config.freshness || '7d';
  const results=await Promise.allSettled([0,25,50].map(start=>withDeadline(async signal=>{
    const url=new URL('https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search');
    url.search=new URLSearchParams({keywords:text(query,150),location:text(config.SEARCH_LOCATION || config.SEARCH_COUNTRY || '',150),...(freshness==='any'?{}:{f_TPR:freshness==='24h'?'r86400':'r604800'}),start:String(start)});
    const response=await boundedFetcher(fetcher,signal)(url.href,{headers:{Accept:'text/html'},redirect:'error'});
    if(!response.ok){await response.body?.cancel();fail(`LinkedIn public search returned HTTP ${response.status}; other sources continue.`,502);}
    let html;const reader=response.body?.getReader();
    if(reader){const chunks=[];let size=0;try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>1500000){await reader.cancel();fail('LinkedIn public search exceeded the response limit.',502);}chunks.push(part.value);}}finally{reader.releaseLock();}html=Buffer.concat(chunks).toString('utf8');}
    else html=await response.text();
    if(html.length>1500000)fail('LinkedIn public search exceeded the response limit.',502);
    if(/authwall|captcha|challenge-page|sign in to view/i.test(html) && !/base-search-card__title/.test(html))fail('LinkedIn requires direct browser access for this search. Other sources continue.',502);
    const jobs=parseLinkedInCards(html,query);
    if(!jobs.length && html.trim() && !/no results|no jobs|no matching|^\s*$/i.test(html))fail('LinkedIn returned an unrecognized public page; other sources continue.',502);
    return jobs;
  },4000)));
  const successes=results.filter(r=>r.status==='fulfilled');
  if(!successes.length)throw results.find(r=>r.status==='rejected').reason;
  // Partial pages are useful; a blocked page is never retried with evasive access.
  return [...new Map(successes.flatMap(r=>r.value).map(j=>[j.id,j])).values()];
}
