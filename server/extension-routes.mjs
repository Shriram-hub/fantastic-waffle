import {sameApplicationLocation} from '../extension/location.mjs';
import {fail,safeUrl} from './domain.mjs';
import {rankOpportunity,buildSearchPlan} from './services/search-plan.mjs';
import {getSearchConfig} from './services/discovery.mjs';
import {ensureJobDocuments,hydrateDocument} from './services/job-documents.mjs';

export async function extensionEnhancements(req,res,url,{json,bodyJSON,valid,store,queue,config,fetcher}) {
  if(!['/api/extension/documents','/api/extension/copilot'].includes(url.pathname))return false;
  if(req.method!=='POST')fail('Method not allowed.',405);
  const data=await bodyJSON(req),source=safeUrl(data.url);if(!source || new URL(source).protocol!=='https:')fail('Use a public HTTPS application page.');
  let job=null;
  if(data.taskId) {
    const row=await store.db.prepare("SELECT * FROM apply_tasks WHERE id=? AND token_hash=? AND lease_until>? AND status IN ('leased','needs-review','blocked','submission-pending')").get(data.taskId,valid.id,Date.now());
    const a=store.state.applications.find(a=>a.id===row?.application_id);job=store.state.jobs.find(j=>j.id===a?.jobId);
    if(!job || !sameApplicationLocation(job.url,source))fail('This page is not the paired application.',409);
  } else job=store.state.jobs.find(j=>sameApplicationLocation(j.url,source));
  if(url.pathname==='/api/extension/documents') {
    if(!data.taskId || !job)fail('Queue this role in Orbit before preparing application documents.',409);
    const item=await ensureJobDocuments(job,store,queue,config,fetcher,false);if(!item)fail('Your profile changed while preparing documents. Retry.',409);
    json(res,200,{documentId:item.id,resume:await hydrateDocument(item,'resume',store,config),coverLetter:await hydrateDocument(item,'coverLetter',store,config)});return true;
  }
  if(!job){json(res,200,{matched:false,message:'Queue this exact job link in Orbit to see a match, documents and hiring contacts.'});return true;}
  const match=rankOpportunity(job,buildSearchPlan(store.state,await getSearchConfig(store))),candidate=JSON.stringify(store.state.profile.master || store.state.profile).toLowerCase()+String(store.state.resume?.text || '').toLowerCase();
  const keywords=[...(job.tags || []),'Excel','SQL','Python','Financial modeling','Valuation','DCF','Accounting','IFRS','GAAP','Power BI','React','TypeScript','JavaScript','Risk management','Cash flow'];
  const missing=[...new Set(keywords)].filter(k=>String(job.description || '').toLowerCase().includes(k.toLowerCase()) && !candidate.includes(k.toLowerCase())).slice(0,10);
  const contacts=store.state.contacts.filter(c=>!c.suppressed && !c.isDemo && (c.jobId===job.id || job.companyDomain && c.companyDomain===job.companyDomain)).slice(0,5).map(c=>({name:c.name,title:c.title,linkedinUrl:c.linkedinUrl || '',emailStatus:c.emailStatus}));
  json(res,200,{matched:true,job:{id:job.id,title:job.title,company:job.company},match:{score:match.score,reasons:match.reasons},missingKeywords:missing,contacts,note:'Unlisted keywords are review prompts, not instructions to add unsupported skills.'});return true;
}
