import {hydrateJobDetail} from './job-details.mjs';
import {contactTargeting,prioritizeContact,matchesPersona,PERSONA_FILTERS} from './contact-personas.mjs';
import {companyPattern,observeCompanyEmails} from './company-patterns.mjs';
import {withDeadline,boundedFetcher} from '../providers/deadline.mjs';
import {hash,id,now,fail,text,sampleEmail} from '../domain.mjs';
import {resolveCompany,companyDomain} from '../providers/contacts/company.mjs';
import {searchHunterDomain,searchHunterCompany,findHunterEmail} from '../providers/contacts/hunter.mjs';
import {findPublicContacts} from '../providers/contacts/free-xray.mjs';
import {verifyWorkEmail,checkEmailDomain} from '../providers/contacts/verification.mjs';
import {getPolicy,activity} from './autopilot-policy.mjs';
import {providerCall} from './provider-budget.mjs';
import {buildSearchPlan,rankOpportunity} from './search-plan.mjs';
import {getSearchConfig} from './discovery.mjs';
import {prioritizeWarmContacts} from './warm-connections.mjs';
import {domainMailHealth} from '../providers/contacts/dns.mjs';
import {recordContactProviderFailure} from './contact-provider-checks.mjs';
import {permuteEmails} from '../providers/contacts/permutator.mjs';
import {effectiveProviderConfig} from './provider-config.mjs';
import {searchProspeoDomain,findProspeoEmail} from '../providers/contacts/prospeo.mjs';
import {findGetProspectEmail} from '../providers/contacts/getprospect.mjs';
import {searchMineleadDomain} from '../providers/contacts/minelead.mjs';
import {githubCommitContacts} from '../providers/contacts/github-commits.mjs';

const week=()=>Math.floor(Date.now()/(7*86400000));
const retryFor=error=>error.status===429 ? Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth(),new Date().getUTCDate()+1,0,5) : null;
export async function findCompanyContacts(job,company,{store,config={},fetcher=fetch,pages,lookupMx,allowCredits=false,allowWarmSearch=false,limit=3,dailyLimit=20,seedContacts=[],hunterSearched=false,allowPublic=true,targetPersona='all'}={}) {
  config=await effectiveProviderConfig(store,config);
  const targeting=contactTargeting(job,store.state.profile),contextKey=hash([targeting.field,targeting.reporting,targetPersona]);
  const savedCompany=await companyPattern(store,company.domain);Object.assign(company,{...savedCompany,...company,learnedPattern:savedCompany.learnedPattern});
  const healthPending=withDeadline(signal=>domainMailHealth(company.domain,{lookupMx,fetcher:boundedFetcher(fetcher,signal)}),4000).catch(()=>({domain:company.domain,status:'unknown',hasMx:false,gateway:'Unknown',provider:'DNS',reason:'Domain check reached its deadline'}));
  const warnings=[],existing=store.state.contacts.filter(c=>!c.isDemo && !c.suppressed && c.emailStatus==='verified' && c.email?.split('@')[1]===company.domain);
  const published=(job.publicHiringEmails || []).filter(c=>c.email?.split('@')[1]?.toLowerCase()===company.domain).map(c=>({id:id(),name:'Hiring contact',title:'Published hiring contact',email:c.email.toLowerCase(),company:job.company,companyDomain:company.domain,emailStatus:'unverified',source:'Public hiring post',suppressed:false,isDemo:false,createdAt:now(),verification:{provider:'Public hiring post',status:'unverified',reference:c.sourceUrl,at:now(),result:'Published in a hiring post; mailbox not verified.'}}));
  let candidates=[...existing,...seedContacts,...published],retryAt=null;
  const needsDiscovery=()=>candidates.filter(c=>{const ranked=prioritizeContact(c,targeting);return ranked.emailStatus==='verified' && matchesPersona(ranked,targetPersona) && (targetPersona!=='all' || ranked.persona==='manager');}).length<Math.min(3,limit);
  const call=(key,fn)=>providerCall(store,`contacts-v4:${hash(config.HUNTER_API_KEY || '')}:${week()}:${contextKey}:${key}`,'Hunter',dailyLimit,fn);
  const hunterPending=(async()=>{
  if(!hunterSearched && allowCredits && config.HUNTER_API_KEY && needsDiscovery()) {
    try{const result=await call(`domain:${company.domain}`,()=>withDeadline(signal=>searchHunterDomain(company.domain,config.HUNTER_API_KEY,10,boundedFetcher(fetcher,signal),targeting)));candidates.push(...(Array.isArray(result) ? result : result.contacts));if(result.pattern){company.pattern=result.pattern;company.providerPattern={pattern:result.pattern,status:'provider-reported',sampleCount:0,provider:'Hunter',mailboxVerified:false};}}
    catch(error){if(config.CONTACT_READ_ONLY_DISCOVERY!=='true')await recordContactProviderFailure(store,'Hunter',error);retryAt=retryFor(error);warnings.push(error.status ? error.message : 'Hunter could not complete. Public careers-page discovery continued.');}
  }
  })();
  if(allowPublic && needsDiscovery()) {
    try{
      const saved=await store.db.prepare('SELECT body FROM companies WHERE domain=?').get(company.domain),cache=saved ? JSON.parse(saved.body).publicLookup : null,mode=allowWarmSearch ? 'search' : 'public';
      if(cache?.mode===mode && cache?.contextKey===contextKey && Date.now()-Date.parse(cache.at)<86400000)candidates.push(...cache.contacts);
      else {
        const contacts=await findPublicContacts(job,company,{store,pages,fetcher,config,peopleLimit:Math.max(12,limit),searchPeople:true,targeting,targetPersona,freeSearch:config.FREE_CONTACT_WEB_SEARCH!=='false',allowSearch:allowWarmSearch,call:(provider,fn,query)=>providerCall(store,`people-v5:${hash(config[({Serper:'SERPER_API_KEY',Tavily:'TAVILY_API_KEY',SerpApi:'SERPAPI_API_KEY',Brave:'BRAVE_SEARCH_API_KEY'})[provider]] || '')}:${week()}:${provider}:${company.domain}:${hash(query || contextKey)}`,provider,['Serper','Tavily'].includes(provider)?Math.min(500,Number(config.CONTACT_SEARCH_DAILY_LIMIT)||100):Math.min(30,Number(config.JOB_SEARCH_API_DAILY_LIMIT) || 6),fn),warnings});
        candidates.push(...contacts);company.publicLookup={mode,contextKey,at:now(),contacts};
      }
    }
    catch{warnings.push('Public company careers pages were unavailable.');}
  }
  await hunterPending;
  const creditCall=(provider,key,fn)=>providerCall(store,`contacts-v4:${hash(config[({Prospeo:'PROSPEO_API_KEY',GetProspect:'GETPROSPECT_API_KEY',Minelead:'MINELEAD_API_KEY'})[provider]] || '')}:${week()}:${company.domain}:${provider}:${key}`,provider,dailyLimit,fn);
  if(allowCredits && needsDiscovery())for(const [provider,key,search] of [['Minelead',config.MINELEAD_API_KEY,searchMineleadDomain],['Prospeo',config.PROSPEO_API_KEY,searchProspeoDomain]]) {
    if(!key)continue;
    try {const found=await creditCall(provider,'domain',()=>search(company.domain,key,Math.min(25,limit),fetcher));candidates.push(...found.contacts);if(found.pattern)company.pattern=found.pattern;}catch(error){warnings.push(error.status?error.message:`${provider} is unavailable.`);}
    if(!needsDiscovery())break;
  }
  if(config.GITHUB_CONTACT_DISCOVERY==='true')try{candidates.push(...await githubCommitContacts(company,{fetcher,token:config.GITHUB_PUBLIC_TOKEN || '',limit}));}catch(error){warnings.push(error.status?error.message:'GitHub public-source lookup is unavailable.');}
  const health=await healthPending;
  if(allowPublic && health.hasMx && candidates.length<limit)for(const local of ['careers','hr','talent','recruiting']) {
    candidates.push({id:id(),name:'Hiring team',title:'Suggested hiring inbox',email:`${local}@${company.domain}`,company:job.company,companyDomain:company.domain,emailStatus:'unverified',source:'Suggested role inbox',confidence:null,suppressed:false,isDemo:false,createdAt:now(),domainVerification:health,verification:{provider:health.provider,status:'unverified',at:now(),result:'Domain has MX records. This address is a suggestion; its mailbox has not been verified.'}});
    if(candidates.length>=limit)break;
  }
  await observeCompanyEmails(store,company,candidates);
  if(company.learnedPattern?.pattern || company.pattern)for(const c of candidates)if(c.emailInferred && c.emailStatus!=='verified') {
    const first=permuteEmails({...c,companyDomain:company.domain,domainPattern:company.learnedPattern?.pattern || company.pattern})[0];if(first)Object.assign(c,first);
  }
  const byEmail=new Map();
  for(const c of candidates)if(c.email ? !sampleEmail(c.email) && c.email.split('@')[1]?.toLowerCase()===company.domain : c.linkedinUrl || c.hiringPost?.url) {
    const key=c.email?.toLowerCase() || c.linkedinUrl || c.hiringPost?.url,old=byEmail.get(key);if(!old || old.emailStatus!=='verified' && c.emailStatus==='verified')byEmail.set(key,c);
  }
  const warm=await withDeadline(signal=>prioritizeWarmContacts([...byEmail.values()],job,store,config,boundedFetcher(fetcher,signal),allowWarmSearch)).catch(()=>({contacts:[...byEmail.values()],people:[],warnings:['Warm search reached its deadline.']}));
  warnings.push(...warm.warnings);
  const prospects=[];
  for(const person of warm.people)if(!warm.contacts.some(c=>c.name.toLowerCase()===person.name.toLowerCase())) {
    let found=null;
    if(allowCredits && config.HUNTER_API_KEY)try{found=await call(`finder:${company.domain}:${hash(person.name.toLowerCase())}`,()=>findHunterEmail(person,company.domain,config.HUNTER_API_KEY,fetcher));}catch(error){retryAt=Math.max(retryAt || 0,retryFor(error) || 0) || null;warnings.push(error.status ? error.message : 'Warm contact email lookup is unavailable.');}
    prospects.push({id:id(),company:job.company,title:'Shared-background professional',companyDomain:company.domain,email:'',emailStatus:'unverified',source:'Public alumni / past-company search',isDemo:false,suppressed:false,createdAt:now(),...person,...found});
    if(prospects.length>=limit)break;
  }
  const results=[...warm.contacts,...prospects].map(c=>({...prioritizeContact(c,targeting),emailPattern:company.learnedPattern ? {pattern:company.learnedPattern.pattern,status:company.learnedPattern.status,sampleCount:company.learnedPattern.sampleCount} : null})).filter(c=>matchesPersona(c,targetPersona)).sort((a,b)=>b.priorityScore-a.priorityScore || Number(b.emailStatus==='verified')-Number(a.emailStatus==='verified')).slice(0,limit);
  for(const candidate of results) {
    if(!candidate.email && !allowCredits)continue;
    candidate.domainVerification=health;
    candidate.requiresDomainReview=company.requiresDomainReview===true;
    const domainCheck=health.status==='invalid' ? {emailStatus:'invalid',verification:{provider:health.provider,status:'invalid',at:now(),result:health.reason}} : null;
    if(domainCheck)Object.assign(candidate,domainCheck);
    else if(candidate.emailStatus!=='verified' && candidate.emailStatus!=='invalid' && candidate.emailStatus!=='catch-all' && allowCredits) {
      if(config.HUNTER_API_KEY && candidate.email)try {Object.assign(candidate,await call(`verify:${candidate.email}`,()=>verifyWorkEmail(candidate.email,config,fetcher,lookupMx)));}
      catch(error){retryAt=Math.max(retryAt || 0,retryFor(error) || 0) || null;warnings.push(error.status ? error.message : 'Verification was unavailable. The address stays unverified.');}
      if(candidate.emailStatus!=='verified' && candidate.name?.trim().includes(' ') && !/hiring team|company contact/i.test(candidate.name))for(const [provider,key,finder] of [['Prospeo',config.PROSPEO_API_KEY,findProspeoEmail],['GetProspect',config.GETPROSPECT_API_KEY,findGetProspectEmail]]) {
        if(!key)continue;
        try{const found=await creditCall(provider,`person:${hash(candidate.name.toLowerCase())}`,()=>finder(candidate,company.domain,key,fetcher));if(found){const originalId=candidate.id;Object.assign(candidate,found,{id:originalId});}}catch(error){warnings.push(error.status?error.message:`${provider} finder is unavailable.`);}
        if(candidate.emailStatus==='verified')break;
      }
    }
  }
  if(company.requiresDomainReview)warnings.unshift('The domain is a DNS-based suggestion. Confirm the corporate website before outreach.');
  if(!results.length)warnings.unshift(health.hasMx ? 'No published hiring contact was found. Use browser-assisted import or review a company website.' : health.reason);
  await observeCompanyEmails(store,company,results);
  return {contacts:results,targeting,emailPattern:company.learnedPattern || company.providerPattern || null,warnings:[...new Set(warnings)].slice(0,5),retryAt};
}
export async function startContactDiscovery(data,store,queue,config={}) {
  config=await effectiveProviderConfig(store,config);
  if(store.state.isDemo)fail('Start your personal workspace before finding real company contacts.');
  const policy=await getPolicy(store),limit=Number(data.contactsPerCompany ?? 3),companyLimit=Number(data.companyLimit ?? 5);
  if(!Number.isInteger(limit)||limit<1||limit>5||!Number.isInteger(companyLimit)||companyLimit<1||companyLimit>50)fail('Choose 1–50 companies and 1–5 contacts per company.');
  if(!['matches','domains'].includes(data.source || 'matches'))fail('Choose matched jobs or company domains.');
  if(data.allowCredits!==undefined && typeof data.allowCredits!=='boolean')fail('Choose whether to use Hunter credits.');
  const targetPersona=data.targetPersona || 'all';if(!PERSONA_FILTERS.includes(targetPersona))fail('Choose a valid target persona.');
  const allowCredits=data.allowCredits===true;
  if(allowCredits && ![config.HUNTER_API_KEY,config.PROSPEO_API_KEY,config.GETPROSPECT_API_KEY,config.MINELEAD_API_KEY].some(Boolean))fail('Add an email provider in Connections, or use public sources and search.',503);
  const targets=[];
  if(data.source==='domains') {
    const domains=Array.isArray(data.domains) ? data.domains : String(data.domains || '').split(/[\s,;]+/);
    if(domains.length>50)fail('Enter up to 50 company domains.');
    for(const value of domains.filter(Boolean)) {
      const domain=companyDomain(String(value).trim());if(!domain)fail('Use corporate domains such as stripe.com, without paths, personal email services or job boards.');
      if(!targets.some(t=>t.domain===domain))targets.push({company:domain,domain,jobId:null});
    }
  } else {
    const plan=buildSearchPlan(store.state,await getSearchConfig(store));
    const jobs=store.state.jobs.filter(j=>!j.isDemo && !j.archived).map(job=>({job,match:rankOpportunity(job,plan)})).filter(({match})=>match.recommendable && plan.personalized).sort((a,b)=>(b.match.score || 0)-(a.match.score || 0));
    const seen=new Set();
    for(const {job} of jobs) {const key=job.company.trim().toLowerCase();if(!seen.has(key)){seen.add(key);targets.push({company:job.company,jobId:job.id});}}
  }
  targets.splice(companyLimit);if(!targets.length)fail('Add company domains or save target roles and wait for matching jobs first.');
  const allowWarmSearch=data.allowWarmSearch===true;
  if(allowWarmSearch && ![config.SERPER_API_KEY,config.TAVILY_API_KEY,config.SERPAPI_API_KEY,config.BRAVE_SEARCH_API_KEY].some(Boolean))fail('Add Serper or Tavily in Connections for people search.',503);
  const signature=hash({targets,limit,allowCredits,allowWarmSearch,targetPersona});
  const previous=(await contactDiscoveryStatus(store,config)).runs;
  const inProgress=r=>r.targets.some(t=>['queued','running'].includes(t.status));
  const active=previous.find(r=>r.signature===signature && inProgress(r));
  if(active)return {run:active,existing:true};
  if(previous.filter(inProgress).length>=3)fail('Three contact searches are already active. Let one finish or cancel its queued tasks in Automation.',409);
  const run={id:id(),signature,createdAt:now(),contactsPerCompany:limit,allowCredits,allowWarmSearch,targetPersona,dailyLimit:Math.min(100,Math.max(1,Number(config.CONTACT_API_DAILY_LIMIT) || policy.maxContactLookupsPerDay)),targets:targets.map(t=>({...t,id:id(),status:'queued',added:0,verified:0,warnings:[]}))};
  await store.db.exec('BEGIN IMMEDIATE');
  try {
    const activeRuns=previous.filter(inProgress);
    store.state.contactDiscoveryRuns=[run,...activeRuns,...previous.filter(r=>!inProgress(r)).slice(0,29-activeRuns.length)];
    for(const target of run.targets){const queued=await queue.enqueue('contacts.discover',{runId:run.id,targetId:target.id},{dedupeKey:`contact-discovery-${run.id}-${target.id}`,maxAttempts:3});target.taskId=queued.id;}
    await store.save(true);await store.db.exec('COMMIT');
  } catch(error){await store.db.exec('ROLLBACK');throw error;}
  return {run};
}
export async function discoverCompanyTask(task,store,queue,config={},fetcher=fetch,{lookupMx,contactPages}={}) {
  config=await effectiveProviderConfig(store,config);
  const get=()=>{const run=(store.state.contactDiscoveryRuns || []).find(r=>r.id===task.payload.runId);return {run,target:run?.targets.find(t=>t.id===task.payload.targetId)};};
  let {run,target}=get();if(!run || !target || !['queued','running'].includes(target.status))return {status:'cancelled'};
  const original=target.jobId ? store.state.jobs.find(j=>j.id===target.jobId) : null;
  const job=await hydrateJobDetail(original,store) || {company:target.company,title:'Career opportunities',url:`https://${target.domain}/careers`,description:''};
  target.status='running';await store.save();
  let company=target.domain ? {domain:target.domain,name:target.company,source:'User-selected company domain'} : await resolveCompany(job,fetcher,store),hunterResult=null,lookupWarning='',lookupRetryAt=null;
  if(!company && run.allowCredits && config.HUNTER_API_KEY) {
    try{hunterResult=await providerCall(store,`contacts-v2:${hash(config.HUNTER_API_KEY)}:${week()}:company:${hash(job.company.toLowerCase())}`,'Hunter',run.dailyLimit,()=>searchHunterCompany(job.company,config.HUNTER_API_KEY,5,fetcher));company=hunterResult.company;}
    catch(error){lookupWarning=error.status ? error.message : 'Company lookup could not complete.';lookupRetryAt=retryFor(error);}
  }
  if(!company) {
    if(lookupRetryAt){Object.assign(target,{status:'queued',retryAt:lookupRetryAt,warnings:[lookupWarning]});await store.save();return {status:'deferred',runAt:lookupRetryAt};}
    target.status='needs-domain';target.warnings=[lookupWarning,'The company domain could not be resolved confidently. Search its corporate domain directly.'].filter(Boolean);await store.save();return {status:'Needs domain'};
  }
  const found=await findCompanyContacts(job,company,{store,config,fetcher,pages:contactPages,lookupMx,allowCredits:run.allowCredits,allowWarmSearch:run.allowWarmSearch,limit:run.contactsPerCompany,dailyLimit:run.dailyLimit,seedContacts:hunterResult?.contacts || [],hunterSearched:!!hunterResult,targetPersona:run.targetPersona || 'all'});
  await store.refresh();({run,target}=get());if(!run || !target || !['queued','running'].includes(target.status))return {status:'cancelled'};
  await store.db.prepare('INSERT INTO companies(domain,name,body) VALUES(?,?,?) ON CONFLICT(domain) DO UPDATE SET body=excluded.body').run(company.domain,job.company,JSON.stringify(company));
  const saved=[];let added=0;
  for(const incoming of found.contacts) {
    let contact=store.state.contacts.find(c=>incoming.email ? c.email?.toLowerCase()===incoming.email.toLowerCase() : incoming.linkedinUrl && c.linkedinUrl===incoming.linkedinUrl);
    if(contact?.suppressed || contact?.isDemo)continue;
    if(!contact){contact={...incoming,id:id(),company:job.company,companyDomain:company.domain,jobId:original?.id || null};store.state.contacts.push(contact);added++;}
    else if(incoming.emailStatus==='verified' || contact.emailStatus!=='verified')Object.assign(contact,{emailStatus:incoming.emailStatus,verification:incoming.verification,domainVerification:incoming.domainVerification,requiresDomainReview:incoming.requiresDomainReview,sources:incoming.sources || contact.sources,companyDomain:company.domain,jobId:contact.jobId || original?.id || null});
    Object.assign(contact,prioritizeContact({...contact,...incoming},found.targeting),{id:contact.id,jobId:contact.jobId || original?.id || null});
    contact.discoveryRunId=run.id;saved.push(contact);
    if(original && contact.jobId===original.id)Object.assign(contact,{jobTitle:original.title,jobUrl:original.url});
  }
  Object.assign(target,{targeting:found.targeting,emailPattern:found.emailPattern ? {pattern:found.emailPattern.pattern,status:found.emailPattern.status,sampleCount:found.emailPattern.sampleCount} : null,domain:company.domain,requiresDomainReview:company.requiresDomainReview===true,status:found.retryAt ? 'queued' : !saved.length ? 'needs-attention' : 'completed',added:(target.added || 0)+added,verified:saved.filter(c=>c.emailStatus==='verified' && !c.requiresDomainReview).length,contactIds:saved.map(c=>c.id),warnings:found.warnings,retryAt:found.retryAt,completedAt:found.retryAt ? null : now()});
  await store.save();await activity(store,'contacts',`${job.company}: ${added} new contacts, ${target.verified} verified.`,added);
  return {added,verified:target.verified,warnings:found.warnings,...(found.retryAt ? {status:'deferred',runAt:found.retryAt} : {})};
}
export async function contactDiscoveryStatus(store,config={}) {
  config=await effectiveProviderConfig(store,config);
  const policy=await getPolicy(store),today=new Date().toISOString().slice(0,10);
  const tasks=new Map((await store.db.prepare("SELECT id,status FROM tasks WHERE kind IN ('contacts.discover','contacts.bulk') ORDER BY created_at DESC LIMIT 1500").all()).map(t=>[t.id,t.status]));
  const runs=structuredClone(store.state.contactDiscoveryRuns || []).map(r=>({...r,targets:r.targets.map(t=>['queued','running'].includes(t.status) && ['failed','cancelled'].includes(tasks.get(t.taskId)) ? {...t,status:tasks.get(t.taskId),warnings:[...t.warnings,'The background lookup did not finish. See Automation for task details.']} : t)}));
  return {hunterConfigured:!!config.HUNTER_API_KEY,emailFinderConfigured:[config.HUNTER_API_KEY,config.PROSPEO_API_KEY,config.GETPROSPECT_API_KEY,config.MINELEAD_API_KEY].some(Boolean),serperConfigured:!!config.SERPER_API_KEY,apolloConfigured:!!config.APOLLO_API_KEY,warmSearchConfigured:!!(config.SERPER_API_KEY || config.TAVILY_API_KEY || config.SERPAPI_API_KEY || config.BRAVE_SEARCH_API_KEY),providerChecks:store.state.contactProviderChecks || null,searchDailyLimit:Math.min(500,Number(config.CONTACT_SEARCH_DAILY_LIMIT)||100),dailyLimit:Math.min(100,Math.max(1,Number(config.CONTACT_API_DAILY_LIMIT) || policy.maxContactLookupsPerDay)),usedToday:Number((await store.db.prepare("SELECT count(*) AS count FROM provider_requests WHERE day=? AND provider NOT IN ('JSearch','SerpApi','Brave','Serper','Tavily')").get(today)).count),runs};
}
