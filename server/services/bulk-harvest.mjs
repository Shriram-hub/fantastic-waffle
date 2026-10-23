import {id,hash,now,fail} from '../domain.mjs';
import {companyDomain,resolveCompany,cleanCompanyName} from '../providers/contacts/company.mjs';
import {findCompanyContacts} from './contact-discovery.mjs';
import {effectiveProviderConfig} from './provider-config.mjs';
import {buildSearchPlan,rankOpportunity} from './search-plan.mjs';
import {getSearchConfig} from './discovery.mjs';
import {serperSearch,tavilySearch} from '../providers/contacts/serper-xray.mjs';
import {providerCall} from './provider-budget.mjs';
import {activity} from './autopilot-policy.mjs';
import {withDeadline} from '../providers/deadline.mjs';
import {catalogReady,queryCatalog,catalogJob} from './job-catalog.mjs';
import {PERSONA_FILTERS} from './contact-personas.mjs';

export const SECTOR_PRESETS={
  finance:{name:'Investment Banking & PE',companies:['Goldman Sachs','JPMorgan Chase','Morgan Stanley','BlackRock','Citi','UBS','Deutsche Bank','Barclays','HSBC','State Street']},
  consulting:{name:'Big 4 & Consulting',companies:['Deloitte','EY','KPMG','PwC','Accenture','McKinsey','Bain','Boston Consulting Group','BDO India']},
  fintech:{name:'Indian Unicorns & Fintech',companies:['Razorpay','Zerodha','Cred','PhonePe','Groww','Paytm','Pine Labs','BharatPe','Meesho','Zepto']},
  technology:{name:'Global Big Tech',companies:['Microsoft','Google','Amazon','Apple','Meta','Nvidia','Adobe','Salesforce','Oracle','Cisco']},
};
const configuredSearch=c=>!!(c.SERPER_API_KEY || c.TAVILY_API_KEY || c.SERPAPI_API_KEY || c.BRAVE_SEARCH_API_KEY);
export async function startBulkHarvest(data,store,queue,base={}) {
  if(store.state.isDemo)fail('Start your personal workspace before discovering contacts.');
  const config=await effectiveProviderConfig(store,base),limit=Number(data.contactsPerCompany ?? 10),companyLimit=Number(data.companyLimit ?? 25);
  if(!Number.isInteger(limit) || limit<1 || limit>15 || !Number.isInteger(companyLimit) || companyLimit<1 || companyLimit>100)fail('Choose up to 100 companies and 1–15 contacts per company.');
  const allowCredits=data.allowCredits===true,allowSearch=data.allowSearch===true;
  if(allowSearch && !configuredSearch(config))fail('Add Serper or Tavily in Connections to search for people.',503);
  if(allowCredits && ![config.HUNTER_API_KEY,config.PROSPEO_API_KEY,config.GETPROSPECT_API_KEY,config.MINELEAD_API_KEY].some(Boolean))fail('Add an email provider in Connections before using email lookup credits.',503);
  if(!PERSONA_FILTERS.includes(data.targetPersona || 'all'))fail('Choose a valid target persona.');
  const source=data.source || 'matches',targets=[];
  if(source==='matches') {
    const plan=buildSearchPlan(store.state,await getSearchConfig(store));
    if(!plan.personalized)fail('Save your target roles before selecting matching companies.');
    const jobs=store.state.jobs.filter(j=>!j.archived && !j.isDemo).map(job=>({job,match:rankOpportunity(job,plan)})).filter(v=>v.match.recommendable).sort((a,b)=>b.match.score-a.match.score);
    for(const {job} of jobs)if(!targets.some(t=>t.company.toLowerCase()===job.company.toLowerCase()))targets.push({company:job.company,jobId:job.id,...(companyDomain(job.companyDomain) ? {domain:job.companyDomain}: {})});
    if(await catalogReady(store))for(let page=0;page<10 && targets.length<companyLimit;page++) {
      const feed=await queryCatalog(store,plan,{view:'foryou',offset:page*100,limit:100});
      for(const job of feed.jobs)if(!targets.some(t=>t.company.toLowerCase()===job.company.toLowerCase()))targets.push({company:job.company,jobId:job.id,...(companyDomain(job.companyDomain)?{domain:job.companyDomain}:{})});
      if(feed.jobs.length<100)break;
    }
  }else if(source==='companies') {
    const entries=data.preset ? SECTOR_PRESETS[data.preset]?.companies : Array.isArray(data.companies)?data.companies:String(data.companies || '').split(/[,;\n]+/);
    if(!entries || entries.length>50)fail('Enter up to 50 company names or domains, separated by commas or new lines.');
    for(const value of entries){if(typeof value!=='string' || value.trim().length>150)fail('Enter valid company names or corporate domains.');const name=value.trim();if(!name)continue;let domain=companyDomain(name);try{if(/^https?:\/\//i.test(name))domain=companyDomain(new URL(name).hostname);}catch{}if(!targets.some(t=>t.company.toLowerCase()===name.toLowerCase()))targets.push({company:name,domain:domain || null,jobId:null});}
  }else fail('Choose matching jobs or a company list.');
  targets.splice(companyLimit);if(!targets.length)fail('No matching companies yet. Run discovery or provide company names.');
  for(const target of targets)if(target.jobId && !store.state.jobs.some(j=>j.id===target.jobId)){const job=await catalogJob(target.jobId,store);if(job)store.state.jobs.push(job);}
  const options={limit,allowCredits,allowSearch,github:data.github===true,targetPersona:data.targetPersona || 'all'},signature=hash({targets,options});
  const old=(store.state.contactDiscoveryRuns || []).find(r=>r.kind==='bulk' && r.signature===signature && r.targets.some(t=>['queued','running'].includes(t.status)));
  if(old)return {run:old,existing:true};
  if((store.state.contactDiscoveryRuns || []).filter(r=>r.targets.some(t=>['queued','running'].includes(t.status))).length>=3)fail('Three contact searches are active. Wait for one to finish.',409);
  const run={id:id(),kind:'bulk',signature,createdAt:now(),contactsPerCompany:limit,options,targets:targets.map(t=>({...t,id:id(),status:'queued',added:0,verified:0,warnings:[]}))};
  await store.db.exec('BEGIN IMMEDIATE');try{
    store.state.contactDiscoveryRuns=[run,...(store.state.contactDiscoveryRuns || []).slice(0,29)];
    const task=await queue.enqueue('contacts.bulk',{runId:run.id,offset:0},{dedupeKey:`bulk:${run.id}:0`,maxAttempts:2});run.taskId=task.id;for(const target of run.targets)target.taskId=task.id;
    await store.save(true);await store.db.exec('COMMIT');
  }catch(error){await store.db.exec('ROLLBACK');throw error;}
  return {run};
}
async function resolveTarget(target,job,store,config,fetcher) {
  if(target.domain)return {domain:target.domain,name:target.company,source:'User-selected corporate domain'};
  const existing=await withDeadline(()=>resolveCompany(job,fetcher,store),4500).catch(()=>null);
  if(existing && !existing.requiresDomainReview)return existing;
  if(!config.SERPER_API_KEY && !config.TAVILY_API_KEY)return existing;
  const provider=config.SERPER_API_KEY?'Serper':'Tavily',search=provider==='Serper'?serperSearch:tavilySearch,key=config[provider==='Serper'?'SERPER_API_KEY':'TAVILY_API_KEY'];
  const result=await providerCall(store,`company-site:${hash(key)}:${hash(target.company.toLowerCase())}`,provider,Math.min(500,Number(config.CONTACT_SEARCH_DAILY_LIMIT)||100),()=>search(`${target.company} official company website`,key,{fetcher,limit:5}));
  const brand=cleanCompanyName(target.company,{brand:true}).toLowerCase().replace(/[^a-z0-9]/g,'');
  for(const r of result.results)try {const url=new URL(r.link),domain=companyDomain(url.hostname),host=domain.split('.')[0].replace(/[^a-z0-9]/g,'');if(domain && brand.length>=4 && host.includes(brand) && r.title.toLowerCase().includes(cleanCompanyName(target.company).toLowerCase()))return {domain,name:target.company,source:`${provider} corporate website result`,reference:url.href,resolvedAt:now()};}catch{}
  return existing;
}
export async function discoverBulkBatch(task,store,queue,base={},fetcher=fetch,dependencies={}) {
  const config=await effectiveProviderConfig(store,base),get=()=>store.state.contactDiscoveryRuns?.find(r=>r.id===task.payload.runId);
  let run=get();if(!run || run.kind!=='bulk')return {status:'cancelled'};
  const offset=Number(task.payload.offset)||0,targets=run.targets.slice(offset,offset+2).filter(t=>['queued','running'].includes(t.status)),options=run.options;
  if(!targets.length)return {status:'cancelled'};
  for(const target of targets){target.status='running';target.taskId=task.id;}await store.save();
  const results=await Promise.allSettled(targets.map(async target=>{
    const job=store.state.jobs.find(j=>j.id===target.jobId) || {company:target.company,title:'Career opportunities',description:'',url:''};
    const company=await (dependencies.resolveCompany || resolveTarget)(target,job,store,options.allowSearch?config:{...config,SERPER_API_KEY:'',TAVILY_API_KEY:''},fetcher);
    if(!company)return {targetId:target.id,status:'needs-domain',contacts:[],warnings:['No source-supported corporate website was found. Enter a domain to search this company.']};
    const result=await (dependencies.findCompanyContacts || findCompanyContacts)(job,company,{store,config:{...config,CONTACT_READ_ONLY_DISCOVERY:'true',GITHUB_CONTACT_DISCOVERY:options.github?'true':'false'},fetcher,pages:dependencies.contactPages,lookupMx:dependencies.lookupMx,allowCredits:options.allowCredits,allowWarmSearch:options.allowSearch,limit:options.limit,targetPersona:options.targetPersona,dailyLimit:Math.min(100,Number(config.CONTACT_API_DAILY_LIMIT)||20)});
    return {targetId:target.id,company,contacts:result.contacts,warnings:result.warnings,verified:result.contacts.filter(c=>c.emailStatus==='verified').length,status:result.contacts.length?'completed':'needs-attention'};
  }));
  await store.refresh();run=get();if(!run)return {status:'cancelled'};
  for(let i=0;i<results.length;i++) {
    const target=run.targets.find(t=>t.id===targets[i].id),result=results[i];if(!target)continue;
    if(result.status==='rejected'){Object.assign(target,{status:'needs-attention',warnings:[result.reason.status?result.reason.message:'Company discovery could not complete. Try again later.']});continue;}
    const found=result.value,ids=[];let added=0;
    if(found.company?.domain)await store.db.prepare('INSERT INTO companies(domain,name,body) VALUES(?,?,?) ON CONFLICT(domain) DO UPDATE SET body=excluded.body').run(found.company.domain,target.company,JSON.stringify(found.company));
    for(const incoming of found.contacts) {
      if(!incoming.email && !incoming.linkedinUrl)continue;
      let contact=store.state.contacts.find(c=>incoming.email?c.email?.toLowerCase()===incoming.email.toLowerCase():c.linkedinUrl===incoming.linkedinUrl);
      if(contact?.suppressed || contact?.isDemo)continue;
      if(!contact){contact={...incoming,id:id(),company:target.company,companyDomain:found.company.domain,jobId:target.jobId || null,...(target.jobId?{jobTitle:store.state.jobs.find(j=>j.id===target.jobId)?.title || '',jobUrl:store.state.jobs.find(j=>j.id===target.jobId)?.url || ''}:{}),discoveryRunId:run.id,createdAt:now()};store.state.contacts.push(contact);added++;}
      else if(contact.emailStatus!=='verified' && incoming.emailStatus==='verified')Object.assign(contact,{emailStatus:incoming.emailStatus,verification:incoming.verification});
      ids.push(contact.id);
    }
    Object.assign(target,{status:found.status,domain:found.company?.domain || target.domain,requiresDomainReview:found.company?.requiresDomainReview || false,added:(target.added || 0)+added,verified:ids.map(id=>store.state.contacts.find(c=>c.id===id)).filter(c=>c.emailStatus==='verified' && !c.requiresDomainReview).length,contactIds:ids,warnings:found.warnings,completedAt:now()});
  }
  const next=Math.min(offset+2,run.targets.length);
  await store.db.exec('BEGIN IMMEDIATE');try{if(next<run.targets.length){const task=await queue.enqueue('contacts.bulk',{runId:run.id,offset:next},{dedupeKey:`bulk:${run.id}:${next}`,maxAttempts:2});run.taskId=task.id;for(const target of run.targets.slice(next))target.taskId=task.id;}else run.completedAt=now();await store.save(true);await store.db.exec('COMMIT');}catch(error){await store.db.exec('ROLLBACK');throw error;}
  await activity(store,'contacts',`Contact batch: ${next}/${run.targets.length} companies checked.`,next);return {companies:targets.length,more:next<run.targets.length};
}
