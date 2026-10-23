import {providerJSON} from './provider-http.mjs';
import {providerKey} from '../../services/provider-config.mjs';
import {text,safeUrl,fail} from '../../domain.mjs';

export async function serperSearch(query,key,{fetcher=fetch,limit=20,page=1}={}) {
  key=providerKey(key,'serper');if(!key)fail('Add a Serper key in Connections.',503);
  const data=await providerJSON('Serper','https://google.serper.dev/search',{method:'POST',headers:{'X-API-KEY':key,'Content-Type':'application/json'},body:JSON.stringify({q:text(query,600),num:Math.max(1,Math.min(100,limit)),page:Math.max(1,Math.min(5,page))})},fetcher,8000,[key]);
  return {results:(data.organic || []).map(r=>({title:text(r.title,300),link:safeUrl(r.link),snippet:text(r.snippet,1500),date:r.date})).filter(r=>r.link),creditsUsed:Number.isFinite(data.credits)?data.credits:null,knowledgeGraph:data.knowledgeGraph};
}
export async function tavilySearch(query,key,{fetcher=fetch,limit=20}={}) {
  key=providerKey(key,'tavily');if(!key)fail('Add a Tavily key in Connections.',503);
  const data=await providerJSON('Tavily','https://api.tavily.com/search',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({query:text(query,600),max_results:Math.max(1,Math.min(20,limit)),search_depth:'basic',include_answer:false,include_raw_content:false})},fetcher,8000,[key]);
  return {results:(data.results || []).map(r=>({title:text(r.title,300),link:safeUrl(r.url),snippet:text(r.content,1500)})).filter(r=>r.link)};
}
