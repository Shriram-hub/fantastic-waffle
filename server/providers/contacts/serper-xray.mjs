import {providerJSON} from './provider-http.mjs';
import {providerKey} from '../../services/provider-config.mjs';
import {text,safeUrl,fail} from '../../domain.mjs';
import {profileURL} from '../../../shared/contact-discovery.mjs';

export async function serperSearch(query,key,{fetcher=fetch,limit=20,page=1,timeout=8000}={}) {
  key=providerKey(key,'serper');if(!key)fail('Add a Serper key in Connections.',503);
  const data=await providerJSON('Serper','https://google.serper.dev/search',{method:'POST',headers:{'X-API-KEY':key,'Content-Type':'application/json'},body:JSON.stringify({q:text(query,600),num:Math.max(1,Math.min(100,limit)),page:Math.max(1,Math.min(5,page))})},fetcher,Math.min(20000,Math.max(1000,timeout)),[key]);
  return {results:(data.organic || []).map(r=>({title:text(r.title,300),link:safeUrl(r.link),snippet:text(r.snippet,1500),date:r.date})).filter(r=>r.link),creditsUsed:Number.isFinite(data.credits)?data.credits:null,knowledgeGraph:data.knowledgeGraph};
}
export async function tavilySearch(query,key,{fetcher=fetch,limit=20}={}) {
  key=providerKey(key,'tavily');if(!key)fail('Add a Tavily key in Connections.',503);
  const data=await providerJSON('Tavily','https://api.tavily.com/search',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({query:text(query,600),max_results:Math.max(1,Math.min(20,limit)),search_depth:'basic',include_answer:false,include_raw_content:false})},fetcher,8000,[key]);
  return {results:(data.results || []).map(r=>({title:text(r.title,300),link:safeUrl(r.url),snippet:text(r.content,1500)})).filter(r=>r.link)};
}

// Each page is a separate budgeted request. Stop on exhaustion or repeated
// pages, rather than assuming a provider honored the requested page size.
export async function serperPeopleSearch(query,key,{targetCount=50,fetcher=fetch,call=(_p,fn)=>fn(),timeout=4000}={}) {
  if(!Number.isInteger(targetCount) || targetCount<1 || targetCount>100)fail('Choose a target between 1 and 100 contacts.');
  const found=new Map();let pages=0;
  for(let page=1;page<=5 && found.size<targetCount;page++){
    const data=await call('Serper',()=>serperSearch(query,key,{fetcher,limit:50,page,timeout}),`${query}\npage:${page}:num:50`);pages++;
    const before=found.size;for(const r of data.results){const link=profileURL(r.link);if(link && !found.has(link))found.set(link,{...r,link});}
    if(!data.results.length || found.size===before)break;
  }
  return {results:[...found.values()].slice(0,targetCount),pages};
}
