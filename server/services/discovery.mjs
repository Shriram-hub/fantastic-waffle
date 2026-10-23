import {compactIndexedJob} from './job-details.mjs';
import {jobFreshness} from './job-freshness.mjs';
import {gzipSync,gunzipSync} from 'node:zlib';
import {hash,id,now,text,fail} from '../domain.mjs';
import {fetchJobs,canonicalJobKey} from '../providers/jobs/index.mjs';
import boards from '../providers/jobs/boards.json' with {type:'json'};
import {SEARCH_DEFAULTS,buildSearchPlan,rankOpportunity} from './search-plan.mjs';
import {activity,getPolicy,profileScope} from './autopilot-policy.mjs';
import {knownBoards,rememberBoards} from '../providers/jobs/registry.mjs';
import {providerCall} from './provider-budget.mjs';
import {crawlCareerPage} from '../providers/jobs/career-pages.mjs';
import {boardURL,discoverATSBoards} from '../providers/jobs/ats-search.mjs';
import {compactRank,rankedMatch} from './job-feed.mjs';
import {putCatalogJobs,catalogReady,catalogStats,compactWorkspace,CATALOG_CAPACITY,scheduleCatalog,archiveMissingCatalogJobs} from './job-catalog.mjs';

export const DISCOVERY_INTERVAL=2*3600000;
// Keep retained provider payloads small enough for Render's shared free instance.
const BATCH_SIZE=4;
export const MAX_INDEX=15000;
const sourceKey=d=>hash([d.source,d.board,d.page || 1,d.location || '',d.country || '',d.query || '',d.freshness || '7d']);
const cacheCleanups=new WeakMap();
export async function pruneSourceCache(store,ceiling=32*1048576) {
  if((cacheCleanups.get(store) || 0)>Date.now())return;
  cacheCleanups.set(store,Date.now()+10*60000);
  await store.db.prepare('DELETE FROM job_source_cache WHERE expires_at<?').run(Date.now()-86400000);
  let bytes=Number((await store.db.prepare('SELECT SUM(length(body)) AS bytes FROM job_source_cache').get()).bytes || 0);
  while(bytes>ceiling){const page=await store.db.prepare('SELECT id,length(body) AS bytes FROM job_source_cache ORDER BY expires_at,id LIMIT 100').all();if(!page.length)break;const ids=[];for(const row of page){ids.push(row.id);bytes-=Number(row.bytes);if(bytes<=ceiling)break;}await store.db.prepare(`DELETE FROM job_source_cache WHERE id IN (${ids.map(()=>'?').join(',')})`).run(...ids);}
}
export const SOURCE_DEFAULTS=Object.freeze({'Remotive':true,'Arbeitnow':true,'Remote OK':true,'Jobicy':true,'Himalayas':true,'Greenhouse':true,'Lever':true,'Ashby':true,'Google Jobs':false,'LinkedIn Guest':true,'India & finance boards':true,'SmartRecruiters':true,'Workable':true,'Recruitee':true,'Lever EU':true,'Workday':true,'The Muse':true,'Career Pages':true,'VC Portfolios':true,'Adzuna':false,'Keka':true,'Darwinbox':true,'Freshteam':true,'Zoho Recruit':true,'Amazon Jobs':true,'ATS Directory Search':true});
export async function getSearchConfig(store) {
  const row=await store.db.prepare("SELECT body FROM job_search_config WHERE id='local'").get();
  const p=store.state.profile;
  const result={...SEARCH_DEFAULTS,roles:p.interests || [],location:p.location || '',workMode:p.workMode || 'Any',...(row ? JSON.parse(row.body) : {})};
  result.sources={...SOURCE_DEFAULTS,...result.sources};return result;
}
export async function saveSearchConfig(data,store,queue,config={}) {
  const old=await getSearchConfig(store);
  const roles=data.roles ?? old.roles;
  if(!Array.isArray(roles) || roles.length>8 || roles.some(r=>typeof r!=='string')) fail('Enter up to eight target roles.');
  const next={...old,enabled:data.enabled ?? true,roles:[...new Set(roles.map(r=>text(r,100)).filter(Boolean))],location:text(data.location ?? old.location,200),country:text(data.country ?? old.country,2).toUpperCase(),freshness:data.freshness || old.freshness || '7d',workMode:data.workMode || old.workMode,experience:data.experience || old.experience,updatedAt:now()};
  if(!['24h','7d','any'].includes(next.freshness))fail('Choose a valid discovery freshness window.');
  if(typeof next.enabled!=='boolean' || !['Any','Remote','Hybrid','On-site'].includes(next.workMode) || !['Any','Internship','Entry level','Mid level','Senior'].includes(next.experience)) fail('Choose valid search preferences.');
  if(next.country && !/^[A-Z]{2}$/.test(next.country)) fail('Use a country code such as IN, GB, or US.');
  next.sources=Object.fromEntries(Object.keys(SOURCE_DEFAULTS).map(key=>[key,(data.sources?.[key] ?? old.sources[key])===true]));
  if(!Object.values(next.sources).some(Boolean)) fail('Keep at least one job source enabled.');
  await store.db.prepare("INSERT INTO job_search_config(id,body) VALUES('local',?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(JSON.stringify(next));
  // Explicit preferences update only search-related profile fields.
  Object.assign(store.state.profile,{interests:next.roles,location:next.location,workMode:next.workMode});
  await store.save();
  await scheduleCatalog(store,queue,config,buildSearchPlan(store.state,next));
  if(next.enabled) await scheduleDiscovery(store,queue,config,true);
  return next;
}
export async function scheduleDiscovery(store,queue,config={},force=false,clock=Date.now()) {
  if(config.ENABLE_JOB_DISCOVERY==='false' || store.state.isDemo) return null;
  let saved=await store.db.prepare("SELECT body FROM job_search_config WHERE id='local'").get();
  if(!saved && !store.state.profile.interests?.length && !store.state.resume?.text && config.DISCOVERY_BOOTSTRAP!=='true') return null;
  if(!saved) {
    await store.db.prepare("INSERT OR IGNORE INTO job_search_config(id,body) VALUES('local',?)").run(JSON.stringify(await getSearchConfig(store)));
  }
  const prefs=await getSearchConfig(store);
  if(!prefs.enabled) return null;
  const plan=buildSearchPlan(store.state,prefs);
  await store.db.exec('BEGIN IMMEDIATE');
  try {
    const active=(await store.db.prepare("SELECT id,body FROM job_search_runs WHERE status IN ('queued','running') ORDER BY created_at DESC LIMIT 1").get());
    if(active && JSON.parse(active.body).scope===plan.scope) {
      const task=await store.db.prepare("SELECT id FROM tasks WHERE kind='jobs.discover' AND status IN ('queued','running') AND payload LIKE ? LIMIT 1").get(`%"runId":"${active.id}"%`);
      if(task) {await store.db.exec('COMMIT');return {id:task.id,runId:active.id,existing:true};}
      await store.db.prepare("UPDATE job_search_runs SET status='failed',updated_at=? WHERE id=?").run(clock,active.id);
    }
    const schedule=await store.db.prepare("SELECT next_run FROM autopilot_schedule WHERE id='jobs'").get();
    const previous=await store.db.prepare('SELECT body FROM job_search_runs ORDER BY created_at DESC LIMIT 1').get();
    if(!force && schedule?.next_run>clock && previous && JSON.parse(previous.body).scope===plan.scope) {await store.db.exec('COMMIT');return null;}
    const runId=id(),body={scope:plan.scope,roles:plan.roles,personalized:plan.personalized,scanned:0,sourcesChecked:0,sourcesTotal:0,failed:0,cached:0,added:0,matched:0};
    await store.db.prepare("INSERT INTO job_search_runs(id,status,body,created_at,updated_at) VALUES(?,'queued',?,?,?)").run(runId,JSON.stringify(body),clock,clock);
    const task=await queue.enqueue('jobs.discover',{runId,scope:plan.scope,offset:0},{dedupeKey:`job-search-${runId}-0`});
    await store.db.prepare("INSERT INTO autopilot_schedule(id,next_run,cursor) VALUES('jobs',?,0) ON CONFLICT(id) DO UPDATE SET next_run=excluded.next_run").run(clock+DISCOVERY_INTERVAL);
    await store.db.exec('COMMIT');return task;
  } catch(e) {await store.db.exec('ROLLBACK');throw e;}
}
export function sourcePlan(plan,settings,prefs,registry=[]) {
  const publicSources=[{source:'Remotive',board:'',ttl:6*3600000},{source:'Arbeitnow',board:'',ttl:DISCOVERY_INTERVAL},{source:'Remote OK',board:'',ttl:DISCOVERY_INTERVAL},{source:'Jobicy',board:'',ttl:DISCOVERY_INTERVAL}];
  for(const role of (plan.roles.length ? plan.roles : ['']).slice(0,6)) for(let page=1;page<=(role ? 3 : 2);page++) publicSources.push({source:'Himalayas',board:role,page,ttl:86400000});
  const custom=['Greenhouse','Lever','Ashby'].flatMap(source=>(settings[`${source.toLowerCase()}Boards`] || []).map(slug=>({source,slug})));
  const locations=plan.locations?.length ? plan.locations : [plan.location || ''];
  // Separate location alternatives before provider calls. Sending "Mumbai or
  // Bengaluru or Delhi" as one city prevents aggregators from geocoding it.
  const queryFor=role=>`${role}${plan.experience==='Internship' && !/intern|trainee|apprentice/i.test(role) ? ' Internship' : plan.experience==='Entry level' && !/junior|entry|graduate/i.test(role) ? ' entry level' : ''}${plan.workMode==='Remote' && !/remote/i.test(role) ? ' remote' : ''}`;
  const pairs=plan.roles.flatMap(role=>locations.map(location=>({board:queryFor(role),location,country:plan.country})));
  const offset=pairs.length ? Math.floor(Date.now()/86400000)*locations.length%pairs.length : 0;
  const rotating=[...pairs.slice(offset),...pairs.slice(0,offset)];
  const paid=prefs.sources['Google Jobs'] ? rotating.slice(0,24).map(pair=>({source:'Google Jobs',...pair,ttl:6*3600000})) : [];
  const guest=pairs.slice(0,32).map(pair=>({source:'LinkedIn Guest',...pair,freshness:prefs.freshness || '7d',ttl:DISCOVERY_INTERVAL}));
  const muse=plan.roles.slice(0,3).flatMap(role=>[1,2,3].map(page=>({source:'The Muse',board:role,page,location:locations[0],ttl:6*3600000})));
  const adzuna=pairs.slice(0,12).map(pair=>({source:'Adzuna',...pair,ttl:6*3600000}));
  const vc=[{source:'VC Portfolios',board:'https://jobs.accel.com/jobs',ttl:6*3600000},{source:'VC Portfolios',board:'https://careers.peakxv.com/jobs',ttl:6*3600000},{source:'VC Portfolios',board:'https://www.ycombinator.com/jobs',ttl:6*3600000}];
  const catalog=[...new Map([...custom,...boards,...registry].map(b=>[`${b.source}:${b.slug}`,b])).values()].flatMap(b=>{
      const roles=['Workday','SmartRecruiters'].includes(b.source) ? plan.roles.slice(0,3) : [''];
    return (roles.length ? roles : ['']).flatMap(query=>(['Workday','SmartRecruiters'].includes(b.source)?[1,2,3]:[1]).map(page=>({source:b.source,board:b.slug,page,query,ttl:DISCOVERY_INTERVAL,company:b.company,companyDomain:b.companyDomain})));
  });
  const regional=plan.country==='IN' && prefs.sources['India & finance boards'] ? locations.slice(0,3).map(location=>({source:'India & finance boards',board:`(${plan.roles.slice(0,4).map(role=>`"${role.replaceAll('"','')}"`).join(' OR ')})${plan.experience==='Internship' ? ' (intern OR internship OR trainee)' : ''}`,location,country:'IN',ttl:24*3600000})) : [];
  const enterprise=pairs.slice(0,6).map(pair=>({source:'Amazon Jobs',...pair,ttl:DISCOVERY_INTERVAL}));
  return [...paid.slice(0,2),...regional,...paid.slice(2),...guest,...publicSources,...muse,...adzuna,...enterprise,...pairs.slice(0,4).map(pair=>({source:'ATS Directory Search',...pair,ttl:86400000})),...vc,...catalog].filter(d=>prefs.sources[d.source]);
}
async function fetchSource(descriptor,store,config,fetcher,plan,queue) {
  const {source,board,ttl,page}=descriptor,key=sourceKey(descriptor);
  let jobs,pagination,cached=false;
  const cache=await store.db.prepare('SELECT body,expires_at FROM job_source_cache WHERE id=?').get(key);
  if(cache?.expires_at>Date.now()) {
    try {const data=JSON.parse(gunzipSync(Buffer.from(cache.body,'base64'),{maxOutputLength:16000000}).toString());jobs=Array.isArray(data)?data:data.jobs;pagination=data.pagination;cached=Array.isArray(jobs);} catch {}
  }
  if(!jobs) {
    const existingSync=store.state.syncs[`${source}:${board}`];
    if(source==='Remotive' && existingSync?.ok && Date.now()-Date.parse(existingSync.at)<ttl) {
      jobs=store.state.jobs.filter(j=>j.source===source && !j.isDemo && !j.archived);cached=true;
    }
  }
  if(!jobs) {
    const fetchSourceJobs=(extra={})=>fetchJobs(source,board,fetcher,{...config,...extra,HIMALAYAS_PAGE:page || 1,ATS_PAGE:page || 1,SEARCH_QUERY:descriptor.query,LINKEDIN_FRESHNESS:descriptor.freshness,SEARCH_LOCATION:descriptor.location,SEARCH_COUNTRY:descriptor.country},board);
    if(['Career Pages','VC Portfolios'].includes(source)) {
      const found=await crawlCareerPage(board,config.CAREER_PAGE_LOADER?{load:config.CAREER_PAGE_LOADER}:{});
      await rememberBoards(found.boards.map(b=>({url:boardURL(b)})),store,queue);
      jobs=found.jobs.map(j=>({...j,source,board}));
      if(!jobs.length && !found.boards.length)fail('Public page has no readable JobPosting data or supported ATS links. Other sources continue.',422);
    } else if(source==='ATS Directory Search') {
      let discovered=[],lastError;const errors=[];
      const providers=[config.SERPER_API_KEY && 'Serper',config.TAVILY_API_KEY && 'Tavily',config.SERPAPI_API_KEY && 'SerpApi'].filter(Boolean);
      if(!providers.length)fail('Add Serper or Tavily to expand the employer directory from web search. Public feeds continue.',503);
      for(const provider of providers)try{const credential=config[({Serper:'SERPER_API_KEY',Tavily:'TAVILY_API_KEY',SerpApi:'SERPAPI_API_KEY'})[provider]];discovered=await providerCall(store,`ats-search:${hash(credential)}:${key}:${Math.floor(Date.now()/86400000)}`,provider,provider==='SerpApi'?Math.min(30,Number(config.JOB_SEARCH_API_DAILY_LIMIT)||6):Math.min(500,Number(config.CONTACT_SEARCH_DAILY_LIMIT)||100),()=>discoverATSBoards(board,descriptor.location,{...config,ATS_DISCOVERY_PROVIDER:provider},fetcher));lastError=null;break;}catch(error){lastError=error;errors.push(`${provider}: ${error.status?error.message:'Search unavailable.'}`);}
      if(lastError)fail(errors.join(' · ').slice(0,1200),502);
      await rememberBoards(discovered.map(b=>({url:boardURL(b)})),store,queue);jobs=[];
    } else if(source==='India & finance boards') {
      if(!config.SERPAPI_API_KEY)fail('Configure SERPAPI_API_KEY for indexed regional-board discovery. Free feeds continue.',503);
      jobs=await providerCall(store,`regional:${key}:${Math.floor(Date.now()/86400000)}`,'SerpApi',Math.max(1,Math.min(30,Number(config.JOB_SEARCH_API_DAILY_LIMIT)||6)),()=>fetchSourceJobs());
    } else if(source==='Google Jobs') {
      if(!config.JSEARCH_API_KEY && !config.SERPAPI_API_KEY) fail('Optional Google Jobs key missing; free feeds and ATS boards continue.',503);
      let lastError;
      for(const provider of [config.JSEARCH_API_KEY && 'JSearch',config.SERPAPI_API_KEY && 'SerpApi'].filter(Boolean)) {
        try {jobs=await providerCall(store,`jobs:${key}:${Math.floor(Date.now()/(6*3600000))}`,provider,Math.max(1,Math.min(30,Number(config.JOB_SEARCH_API_DAILY_LIMIT)||6)),()=>fetchSourceJobs({GOOGLE_JOBS_PROVIDER:provider}));break;}
        catch(e) {lastError=e;}
      }
      if(!jobs) throw lastError;
    } else jobs=await fetchSourceJobs();
    pagination=jobs.pagination;
    jobs=jobs.map(j=>({...j,description:text(j.description,10000),descriptionSourceTruncated:(j.description?.length || 0)>10000,...(descriptor.company ? {company:descriptor.company,...(descriptor.companyDomain?{companyDomain:descriptor.companyDomain,companyDomainSource:'provider'}:{})} : {})}));
    await store.db.prepare('INSERT INTO job_source_cache(id,expires_at,body) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at,body=excluded.body')
      .run(key,Date.now()+ttl,gzipSync(JSON.stringify(pagination?{jobs,pagination}:jobs)).toString('base64'));
  }
  const matched=jobs.filter(j=>rankOpportunity(j,plan).recommendable).length;
  await store.db.prepare("INSERT INTO job_source_health(id,source,board,checked_at,status,scanned,matched,message) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at,status=excluded.status,scanned=excluded.scanned,matched=excluded.matched,message=excluded.message")
    .run(key,source,board,Date.now(),cached ? 'cached' : 'healthy',jobs.length,matched,null);
  await store.db.prepare("UPDATE discovered_boards SET status='active',checked_at=? WHERE source=? AND slug=?").run(Date.now(),source,board);
  return {descriptor,jobs:jobs.map(j=>compactIndexedJob(j,plan,key)),cached,key,pagination};
}
export function mergeDiscoveryResults(state,results,plan) {
  const map=new Map(state.jobs.filter(j=>!j.isDemo).map(j=>[canonicalJobKey(j),j]));
  const before=new Set(map.keys());
  for(const {descriptor,jobs,cached} of results) {
    if(!cached && ['Greenhouse','Lever','Ashby','Lever EU','Workable','Recruitee'].includes(descriptor.source)) for(const old of map.values()) {
      old.sources ||= [{id:old.id,source:old.source,board:old.board || '',url:old.url,active:!old.archived}];
      for(const origin of old.sources) if(origin.source===descriptor.source && origin.board===descriptor.board) origin.active=false;
    }
    for(const job of jobs) {
      if(job.isDemo)continue;
      const key=canonicalJobKey(job),old=map.get(key),origin={id:job.id,source:descriptor.source,board:descriptor.board,url:job.url,active:true};
      if(old) {
        old.sources ||= [{id:old.id,source:old.source,board:old.board || '',url:old.url,active:!old.archived}];
        const prior=old.sources.find(s=>s.id===job.id && s.source===origin.source && s.board===origin.board);
        if(prior) Object.assign(prior,origin);else old.sources.push(origin);
        old.archived=false;old.fetchedAt=job.fetchedAt;
        const sameSource=old.source===job.source && (old.board || '')===(job.board || '');
        if(job.description && (sameSource || (job.descriptionLength || job.description.length)>(old.descriptionLength || old.description?.length || 0)))Object.assign(old,{description:job.description,descriptionLength:job.descriptionLength,descriptionHash:job.descriptionHash,descriptionTruncated:job.descriptionTruncated,indexSkills:job.indexSkills,detailCacheKey:job.detailCacheKey,detailSourceId:job.detailSourceId});
        if(sameSource || !old.publishedAt && job.publishedAt){old.publishedAt=job.publishedAt;old.publishedAtSource=job.publishedAtSource;}
        if(job.postedBy)old.postedBy=job.postedBy;
        if(job.companyDomain) {old.companyDomain=job.companyDomain;old.companyDomainSource=job.companyDomainSource;}
      } else map.set(key,{...job,canonicalKey:key,sources:[origin],discoveredAutomatically:true});
    }
  }
  const pinned=new Set([...state.applications.map(a=>a.jobId),...state.contacts.map(c=>c.jobId),...state.campaigns.map(c=>c.jobId)]);
  const all=[...map.values()].map(j=>{
    if(j.sources?.length) {
      j.archived=!j.sources.some(s=>s.active);
      if(!j.sources.some(s=>s.active && s.url===j.url)) j.url=j.sources.find(s=>s.active)?.url || j.url;
    }
    if(j.expiresAt && (typeof j.expiresAt==='number'?j.expiresAt*1000:Date.parse(j.expiresAt))<Date.now())j.archived=true;
    Object.assign(j,jobFreshness(j));j.discoveryMatch=compactRank(rankOpportunity(j,plan));return j;
  });
  all.sort((a,b)=>(Number(pinned.has(b.id))-Number(pinned.has(a.id))) || Number(b.discoveryMatch.recommendable)-Number(a.discoveryMatch.recommendable) || Number(b.discoveryMatch.eligible)-Number(a.discoveryMatch.eligible) || (b.discoveryMatch.score || 0)-(a.discoveryMatch.score || 0) || (Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0));
  const kept=all.filter((j,i)=>pinned.has(j.id) || i<MAX_INDEX);
  return {jobs:kept,added:kept.filter(j=>!before.has(canonicalJobKey(j))).length};
}
export async function discoverBatch(task,store,queue,config={},fetcher=fetch) {
  await pruneSourceCache(store);
  await store.refresh();
  const prefs=await getSearchConfig(store),plan=buildSearchPlan(store.state,prefs);
  const row=await store.db.prepare('SELECT * FROM job_search_runs WHERE id=?').get(task.payload.runId);
  if(!row) return {status:'cancelled'};
  let progress=JSON.parse(row.body);
  if(!prefs.enabled || plan.scope!==task.payload.scope) {
    await store.db.prepare("UPDATE job_search_runs SET status='cancelled',updated_at=? WHERE id=?").run(Date.now(),row.id);return {status:'cancelled'};
  }
  if(row.status==='completed' || (progress.offset || 0)>(task.payload.offset || 0)) return {count:progress.indexed || 0,matched:progress.matched || 0,cached:true};
  // Freeze a run's source list so newly discovered boards cannot shift offsets.
  const descriptors=progress.descriptors || sourcePlan(plan,store.state.settings,prefs,await knownBoards(store)),offset=task.payload.offset || 0,batch=descriptors.slice(offset,offset+BATCH_SIZE);
  progress.descriptors=descriptors;
  await store.db.prepare("UPDATE job_search_runs SET status='running',updated_at=? WHERE id=?").run(Date.now(),row.id);
  const results=[];let next=0,failed=0,activeFetches=0;const waiting=[];
  // Fan-out adapters (including five LinkedIn pages) share the worker's two
  // network slots instead of multiplying global concurrency per source.
  const limitedFetch=async(url,options={})=>{
    if(activeFetches>=2)await new Promise(resolve=>waiting.push(resolve));
    else activeFetches++;
    try{options.signal?.throwIfAborted();return await fetcher(url,options);}
    finally{const nextFetch=waiting.shift();if(nextFetch)nextFetch();else activeFetches--;}
  };
  await Promise.all(Array.from({length:Math.min(2,batch.length)},async()=>{
    for(;;) {
      const index=next++;if(index>=batch.length) break;
      const descriptor=batch[index];
      try {results.push(await fetchSource(descriptor,store,config,limitedFetch,plan,queue));}
      catch(e) {
        failed++;
        await store.db.prepare("UPDATE discovered_boards SET status='unavailable',checked_at=? WHERE source=? AND slug=?").run(Date.now(),descriptor.source,descriptor.board);
        await store.db.prepare("INSERT INTO job_source_health(id,source,board,checked_at,status,scanned,matched,message) VALUES(?,?,?,?,'unavailable',0,0,?) ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at,status='unavailable',message=excluded.message")
          .run(sourceKey(descriptor),descriptor.source,descriptor.board,Date.now(),e.status ? e.message : 'Source temporarily unavailable.');
      }
    }
  }));
  await store.refresh();
  const current=await getSearchConfig(store);
  if(!current.enabled || buildSearchPlan(store.state,current).scope!==plan.scope) {
    await store.db.prepare("UPDATE job_search_runs SET status='cancelled',updated_at=? WHERE id=?").run(Date.now(),row.id);return {status:'cancelled'};
  }
  const merged=mergeDiscoveryResults(store.state,results,plan);
  if(config.JOB_CATALOG_ENABLED==='true')for(const result of results){const stored=await putCatalogJobs(result.jobs,plan,store,config);if(!stored.paused)await archiveMissingCatalogJobs(result,store);}
  for(const result of results)if(result.pagination?.hasMore) {
    const next={...result.descriptor,page:result.pagination.nextPage};
    if(!descriptors.some(d=>sourceKey(d)===sourceKey(next)))descriptors.push(next);
  }
  await rememberBoards(results.flatMap(r=>r.jobs),store,queue);
  store.state.jobs=merged.jobs;
  for(const result of results) store.state.syncs[`${result.descriptor.source}:${result.descriptor.board}`]={ok:true,at:now(),count:result.jobs.length};
  await store.save();
  const catalogue=config.JOB_CATALOG_ENABLED==='true' && await catalogReady(store);
  if(catalogue)await compactWorkspace(store,plan);
  // Persist counters and the next task together, so a crash cannot lose a batch.
  const priorOffset=progress.offset || 0;
  if(priorOffset<=offset) progress={...progress,offset:offset+batch.length,sourcesTotal:descriptors.length,sourcesChecked:progress.sourcesChecked+batch.length,scanned:progress.scanned+results.reduce((n,r)=>n+r.jobs.length,0),failed:progress.failed+failed,cached:progress.cached+results.filter(r=>r.cached).length,added:progress.added+merged.added};
  progress.matched=merged.jobs.filter(j=>j.discoveryMatch.recommendable && !j.archived).length;progress.indexed=merged.jobs.filter(j=>!j.archived).length;
  if(catalogue){const stats=await catalogStats(store,plan);progress.matched=stats.matches;progress.indexed=stats.active;}
  const more=offset+batch.length<descriptors.length;
  await store.db.exec('BEGIN IMMEDIATE');
  try {
    await store.db.prepare('UPDATE job_search_runs SET status=?,body=?,updated_at=? WHERE id=?').run(more ? 'running' : 'completed',JSON.stringify(progress),Date.now(),row.id);
    if(more) await queue.enqueue('jobs.discover',{runId:row.id,scope:plan.scope,offset:offset+batch.length},{dedupeKey:`job-search-${row.id}-${offset+batch.length}`});
    await store.db.exec('COMMIT');
  } catch(e) {await store.db.exec('ROLLBACK');throw e;}
  await activity(store,'search',`${progress.sourcesChecked}/${descriptors.length} sources checked · ${progress.indexed} live jobs${plan.personalized ? ` · ${progress.matched} related to your preferences` : ''}.`,progress.indexed);
  if(!more) {
    const outreach=await getPolicy(store);
    if(outreach.enabled && outreach.scope===profileScope(store.state)) await queue.enqueue('JOB_DISCOVERY_SWEEP',{policyId:outreach.id},{dedupeKey:`outreach-after-search-${row.id}`});
  }
  return {count:progress.indexed,matched:progress.matched,more};
}
export async function searchStatus(store) {
  const preferences=await getSearchConfig(store),plan=buildSearchPlan(store.state,preferences);
  const run=await store.db.prepare('SELECT * FROM job_search_runs ORDER BY created_at DESC LIMIT 1').get();
  const health=await store.db.prepare('SELECT * FROM job_source_health ORDER BY checked_at DESC LIMIT 1000').all();
  const details=run ? JSON.parse(run.body) : null;if(details) delete details.descriptors;
  const matches=store.state.jobs.filter(j=>!j.archived && !j.isDemo).map(j=>rankedMatch(j,plan));
  const catalogue=await catalogStats(store,plan),directory=await store.db.prepare("SELECT status,body,updated_at FROM directory_sync WHERE id='directories'").get(),storage=await store.db.prepare("SELECT status,body FROM directory_sync WHERE id='catalog-storage'").get();
  return {preferences,plan,indexCapacity:catalogue?CATALOG_CAPACITY:MAX_INDEX,catalogue,directory:directory?{status:directory.status,...JSON.parse(directory.body),updatedAt:directory.updated_at}:null,storage:storage?{status:storage.status,...JSON.parse(storage.body)}:null,curatedEmployers:boards.length,firstMover:catalogue?.firstMover ?? store.state.jobs.filter(j=>!j.archived && jobFreshness(j).firstMover).length,run:run ? {...run,details,body:undefined} : null,sources:health,schedule:await store.db.prepare("SELECT next_run FROM autopilot_schedule WHERE id='jobs'").get() || null,
    indexed:catalogue?.active ?? store.state.jobs.filter(j=>!j.archived && !j.isDemo).length,matches:plan.personalized ? catalogue?.matches ?? matches.filter(m=>m.recommendable).length : null,
    strongMatches:catalogue?.strong ?? matches.filter(m=>m.tier==='strong').length,
    adjacentMatches:catalogue?.adjacent ?? matches.filter(m=>m.tier==='adjacent').length};
}
