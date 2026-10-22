import {queryJobFeed} from './services/job-feed.mjs';
import {hydrateJobDetail} from './services/job-details.mjs';
import {jobFreshness} from './services/job-freshness.mjs';
import {addCareerURL,listCareerBoards} from './providers/jobs/registry.mjs';
import {taskQueue} from './queue.mjs';
import {getSearchConfig,saveSearchConfig,scheduleDiscovery,searchStatus} from './services/discovery.mjs';
import {buildSearchPlan,rankOpportunity} from './services/search-plan.mjs';
import {fail} from './domain.mjs';

export function setupReadiness(store,config) {
  const aiConfigured=!!(config.LLM_API_KEY && config.LLM_MODEL);
  let geminiConfigured=aiConfigured && String(config.LLM_PROVIDER || '').toLowerCase()==='gemini';
  try {geminiConfigured ||= aiConfigured && new URL(config.LLM_BASE_URL).hostname==='generativelanguage.googleapis.com';}catch{}
  return {apolloConfigured:!!config.APOLLO_API_KEY,hunterConfigured:!!config.HUNTER_API_KEY,jsearchConfigured:!!config.JSEARCH_API_KEY,serpapiConfigured:!!config.SERPAPI_API_KEY,braveConfigured:!!config.BRAVE_SEARCH_API_KEY,adzunaConfigured:!!(config.ADZUNA_APP_ID && (config.ADZUNA_APP_KEY || config.ADZUNA_API_KEY)),museConfigured:!!config.MUSE_API_KEY,googleConfigured:!!(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET && config.TOKEN_ENCRYPTION_KEY),microsoftConfigured:!!(config.MICROSOFT_CLIENT_ID && config.MICROSOFT_CLIENT_SECRET && config.TOKEN_ENCRYPTION_KEY),resendConfigured:!!(config.RESEND_API_KEY && config.EMAIL_FROM),aiConfigured,geminiConfigured,liveSendEnabled:config.ENABLE_LIVE_SEND==='true'};
}
export function discoveryRoutes(store,config) {
  const queue=taskQueue(store);
  return async(req,res,url,{json,bodyJSON})=>{
    const path=url.pathname;
    if(path==='/api/setup' && req.method==='GET') {json(res,200,setupReadiness(store,config));return true;}
    if(path==='/api/search' && req.method==='GET') {json(res,200,await searchStatus(store));return true;}
    if(path==='/api/search' && req.method==='PUT') {
      await saveSearchConfig(await bodyJSON(req),store,queue,config);json(res,202,await searchStatus(store));return true;
    }
    if(path==='/api/jobs/discover' && req.method==='POST') {
      const task=await scheduleDiscovery(store,queue,config,true);json(res,202,{task});return true;
    }
    if(path==='/api/search/career-pages' && req.method==='POST'){const result=await addCareerURL((await bodyJSON(req)).url,store,queue);json(res,202,result);return true;}
    if(path==='/api/search/career-pages' && req.method==='GET'){json(res,200,{boards:await listCareerBoards(store)});return true;}
    if(path==='/api/jobs/feed' && req.method==='GET'){const plan=buildSearchPlan(store.state,await getSearchConfig(store)),options=Object.fromEntries(url.searchParams);options.firstMover=options.firstMover==='true';json(res,200,queryJobFeed(store.state,plan,options));return true;}
    const detail=path.match(/^\/api\/jobs\/([^/]+)$/);
    if(detail && req.method==='GET') {
      const job=store.state.jobs.find(j=>j.id===detail[1]);
      if(!job) fail('Job not found.',404);
      const plan=buildSearchPlan(store.state,await getSearchConfig(store));
      json(res,200,{job:{...await hydrateJobDetail(job,store),...jobFreshness(job),match:rankOpportunity(job,plan)}});return true;
    }
    return false;
  };
}
