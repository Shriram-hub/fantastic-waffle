import {gzipSync,gunzipSync} from 'node:zlib';
import {hash,fail} from '../domain.mjs';
import {canonicalJobKey} from '../providers/jobs/index.mjs';
import {serializeFeedJob} from './job-feed.mjs';
import {rankOpportunity,buildSearchPlan} from './search-plan.mjs';
export const CATALOG_CAPACITY=250000,WORKSPACE_JOB_LIMIT=1500;
const snapshots=new WeakMap();
const decode=row=>({...JSON.parse(gunzipSync(Buffer.from(row.body,'base64'),{maxOutputLength:100000}).toString()),id:row.id,canonicalKey:row.canonical_key});
export async function catalogReady(store){return (await store.db.prepare("SELECT status FROM directory_sync WHERE id='catalog'").get())?.status==='completed';}
export async function catalogStats(store,plan) {
  if(!await catalogReady(store))return null;
  const cached=snapshots.get(store);if(cached?.scope===plan.scope && cached.until>Date.now())return cached.value;
  const row=await store.db.prepare("SELECT count(*) AS total,SUM(CASE WHEN archived=0 THEN 1 ELSE 0 END) AS active,SUM(CASE WHEN archived=0 AND scope=? AND recommendable=1 THEN 1 ELSE 0 END) AS matches,SUM(CASE WHEN archived=0 AND scope=? AND tier='strong' THEN 1 ELSE 0 END) AS strong,SUM(CASE WHEN archived=0 AND scope=? AND tier='adjacent' THEN 1 ELSE 0 END) AS adjacent,SUM(CASE WHEN archived=0 AND published_at>? THEN 1 ELSE 0 END) AS fresh FROM job_catalog").get(plan.scope,plan.scope,plan.scope,Date.now()-86400000);
  const sources=(await store.db.prepare('SELECT DISTINCT source FROM job_catalog WHERE archived=0 ORDER BY source').all()).map(r=>r.source);
  const value={total:Number(row.total)||0,active:Number(row.active)||0,matches:Number(row.matches)||0,strong:Number(row.strong)||0,adjacent:Number(row.adjacent)||0,firstMover:Number(row.fresh)||0,capacity:CATALOG_CAPACITY,sources};snapshots.set(store,{scope:plan.scope,until:Date.now()+15000,value});return value;
}
function compact(job) {
  const fields=['id','title','company','location','workMode','url','source','board','companyDomain','companyDomainSource','publishedAt','publishedAtSource','publishedAtIsUpdate','postedAt','fetchedAt','tags','type','salary','isDemo','archived','detailCacheKey','detailSourceId','descriptionHash','descriptionLength','descriptionTruncated','indexSkills','descriptionUnavailable','requiresSourceReview','indexedSnippet','postedBy','expiresAt'];
  const value=Object.fromEntries(fields.filter(k=>job[k]!==undefined).map(k=>[k,job[k]])),description=String(job.description || '');
  value.description=Buffer.from(description.slice(0,280)).toString();
  if(description.length>280){value.descriptionTruncated=true;value.descriptionLength=job.descriptionLength || description.length;value.descriptionHash=job.descriptionHash || hash(description);}return value;
}
export async function putCatalogJobs(jobs,plan,store,config={}) {
  const bySourceId=[...new Map(jobs.filter(j=>!j.isDemo && j.id && j.url).map(j=>[j.id,j])).values()];
  const unique=[...new Map(bySourceId.map(j=>[canonicalJobKey(j),j])).entries()];
  if(!unique.length)return {count:0};
  const count=Number((await store.db.prepare('SELECT count(*) AS count FROM job_catalog').get()).count);let room=Math.max(0,CATALOG_CAPACITY-count);
  if(room<unique.length){const closed=await store.db.prepare('SELECT id FROM job_catalog WHERE archived=1 ORDER BY seen_at,id LIMIT ?').all(Math.min(1000,unique.length-room));if(closed.length){await store.db.prepare(`DELETE FROM job_catalog WHERE id IN (${closed.map(()=>'?').join(',')})`).run(...closed.map(r=>r.id));room+=closed.length;}}
  if(store.kind==='postgres') {
    const size=Number((await store.db.prepare('SELECT pg_database_size(current_database()) AS bytes').get()).bytes);
    const ceiling=Math.max(200,Math.min(10000,Number(config.JOB_DATABASE_BUDGET_MB)||440))*1048576;
    if(size>ceiling){await store.db.prepare("INSERT INTO directory_sync(id,status,body,updated_at) VALUES('catalog-storage','paused',?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,body=excluded.body,updated_at=excluded.updated_at").run(JSON.stringify({reason:'Database storage budget reached. Existing jobs remain searchable.',bytes:size,budget:ceiling}),Date.now());return {count:0,paused:true};}
    await store.db.prepare("DELETE FROM directory_sync WHERE id='catalog-storage'").run();
  }
  let stored=0;
  for(let offset=0;offset<unique.length;offset+=100) {
    const page=unique.slice(offset,offset+100),existing=await store.db.prepare(`SELECT id,canonical_key FROM job_catalog WHERE canonical_key IN (${page.map(()=>'?').join(',')}) OR id IN (${page.map(()=>'?').join(',')})`).all(...page.map(([key])=>key),...page.map(([,job])=>job.id)),known=new Set(existing.map(r=>r.canonical_key)),byId=new Map(existing.map(r=>[r.id,r]));
    const rows=[];
    for(const [key,job] of page){const previous=byId.get(job.id);if(previous && previous.canonical_key!==key){if(known.has(key)){await store.db.prepare('UPDATE job_catalog SET archived=1 WHERE id=?').run(job.id);}else await store.db.prepare('UPDATE job_catalog SET canonical_key=? WHERE id=?').run(key,job.id);}
      if(!known.has(key) && !previous){if(!room)continue;room--;}
      const match=rankOpportunity(job,plan),body=gzipSync(JSON.stringify(compact(job)),{level:4}).toString('base64'),published=Number.isFinite(Date.parse(job.publishedAt)) && Date.parse(job.publishedAt)<=Date.now() && (job.source!=='Greenhouse' || job.publishedAtSource==='first_published')?Date.parse(job.publishedAt):0;
      rows.push([existing.find(r=>r.canonical_key===key)?.id || job.id,key,job.source || 'Company',job.board || '',job.workMode || '',`${job.title} ${job.company} ${job.location || ''} ${(job.tags || []).join(' ')}`.toLowerCase().slice(0,600),plan.scope,match.score || 0,match.tier || 'other',match.eligible?1:0,match.recommendable?1:0,job.archived?1:0,published,Date.now(),body]);
    }
    if(rows.length){await store.db.prepare(`INSERT INTO job_catalog(id,canonical_key,source,board,work_mode,search_terms,scope,score,tier,eligible,recommendable,archived,published_at,seen_at,body) VALUES ${rows.map(()=>`(${Array(15).fill('?').join(',')})`).join(',')} ON CONFLICT(canonical_key) DO UPDATE SET source=excluded.source,board=excluded.board,work_mode=excluded.work_mode,search_terms=excluded.search_terms,scope=excluded.scope,score=excluded.score,tier=excluded.tier,eligible=excluded.eligible,recommendable=excluded.recommendable,archived=excluded.archived,published_at=excluded.published_at,seen_at=excluded.seen_at,body=excluded.body`).run(...rows.flat());stored+=rows.length;}
  }
  snapshots.delete(store);return {count:stored,full:!room};
}
export async function catalogJob(id,store){const row=await store.db.prepare('SELECT id,canonical_key,body FROM job_catalog WHERE id=? AND archived=0').get(id);return row?decode(row):null;}
export async function retainCatalogJob(id,store) {
  let job=store.state.jobs.find(j=>j.id===id);if(job)return job;
  job=await catalogJob(id,store);if(!job || job.archived)fail('This indexed job is no longer active.',404);
  store.state.jobs.push(job);await store.save();return job;
}
export async function queryCatalog(store,plan,options={}) {
  const where=['archived=0'],args=[],view=options.view || 'all';
  if(view==='foryou' && plan.personalized){where.push('scope=? AND recommendable=1');args.push(plan.scope);}else if(view==='strong'){where.push("scope=? AND eligible=1 AND tier='strong'");args.push(plan.scope);}else if(view==='adjacent'){where.push("scope=? AND tier='adjacent'");args.push(plan.scope);}
  else if(view==='saved'){const ids=store.state.applications.map(a=>a.jobId);if(!ids.length)return {jobs:[],total:0,offset:0,limit:20,nextCursor:null};where.push(`id IN (${ids.map(()=>'?').join(',')})`);args.push(...ids);}
  const q=String(options.q || '').trim().toLowerCase().slice(0,200);
  if(q){where.push("search_terms LIKE ? ESCAPE '!'");args.push(`%${q.replaceAll('!','!!').replaceAll('%','!%').replaceAll('_','!_')}%`);}
  if(options.source){where.push('source=?');args.push(String(options.source).slice(0,100));}if(options.workMode){where.push('work_mode=?');args.push(options.workMode);}
  if(options.firstMover===true){where.push('published_at>?');args.push(Date.now()-86400000);}
  const total=Number((await store.db.prepare(`SELECT count(*) AS count FROM job_catalog WHERE ${where.join(' AND ')}`).get(...args)).count);
  const signature=hash([plan.scope,q,view,options.source,options.workMode,options.firstMover]),offset=Math.max(0,Math.min(CATALOG_CAPACITY,Number(options.offset)||0)),limit=Math.max(1,Math.min(100,Number(options.limit)||20));
  if(options.cursor){let cursor;try{cursor=JSON.parse(Buffer.from(String(options.cursor),'base64url').toString());}catch{fail('Invalid page cursor.');}if(cursor.signature!==signature || !Number.isFinite(cursor.score) || !Number.isFinite(cursor.published) || typeof cursor.id!=='string' || cursor.id.length>250)fail('This page cursor belongs to a different search.');where.push('(score<? OR (score=? AND published_at<?) OR (score=? AND published_at=? AND id>?))');args.push(cursor.score,cursor.score,cursor.published,cursor.score,cursor.published,cursor.id);}
  const rows=await store.db.prepare(`SELECT id,canonical_key,body,score,published_at FROM job_catalog WHERE ${where.join(' AND ')} ORDER BY score DESC,published_at DESC,id LIMIT ?${options.cursor?'':' OFFSET ?'}`).all(...args,limit,...options.cursor?[]:[offset]);
  const last=rows.at(-1),nextCursor=rows.length===limit?Buffer.from(JSON.stringify({signature,score:Number(last.score),published:Number(last.published_at),id:last.id})).toString('base64url'):null;
  return {jobs:rows.map(row=>serializeFeedJob(decode(row),plan,hash(store.state.resume?.text))),total,offset,limit,nextCursor};
}
export async function compactWorkspace(store,plan) {
  await store.db.exec('BEGIN IMMEDIATE');try {
    await store.refresh();const state=store.state,pinned=new Set([...state.applications,...state.contacts,...state.campaigns,...(state.jobDocuments || []),...(state.jobPitches || [])].map(v=>v.jobId));
    for(const run of state.contactDiscoveryRuns || [])for(const target of run.targets || [])if(['queued','running'].includes(target.status))pinned.add(target.jobId);
    for(const row of await store.db.prepare("SELECT job_id FROM autopilot_runs WHERE status NOT IN ('cancelled','failed','completed','stale')").all())pinned.add(row.job_id);
  const ranked=state.jobs.map(job=>({job,score:rankOpportunity(job,plan).score || 0})).sort((a,b)=>Number(a.job.archived)-Number(b.job.archived) || b.score-a.score),keep=new Set(ranked.slice(0,WORKSPACE_JOB_LIMIT).map(v=>v.job.id));
    for(const id of pinned)keep.add(id);
    const remove=state.jobs.filter(j=>!keep.has(j.id)).map(j=>j.id);
    for(let i=0;i<remove.length;i+=250)await store.db.prepare(`DELETE FROM job_listings WHERE id IN (${remove.slice(i,i+250).map(()=>'?').join(',')})`).run(...remove.slice(i,i+250));
    await store.db.exec('COMMIT');
  }catch(error){await store.db.exec('ROLLBACK');throw error;}
  await store.refresh();return {retained:store.state.jobs.length};
}
// Expire missing postings only for complete, unfiltered native board snapshots.
// Query results and individual pages never prove that another role closed.
export async function archiveMissingCatalogJobs(result,store) {
  const {descriptor,cached,jobs}=result;
  if(cached || descriptor.query || !['Greenhouse','Lever','Ashby','Lever EU','Workable','Recruitee','Keka','Freshteam'].includes(descriptor.source))return;
  const current=new Set(jobs.map(canonicalJobKey));let cursor='';
  for(;;){const page=await store.db.prepare('SELECT id,canonical_key FROM job_catalog WHERE source=? AND board=? AND archived=0 AND id>? ORDER BY id LIMIT 250').all(descriptor.source,descriptor.board,cursor);if(!page.length)break;const ids=page.filter(r=>!current.has(r.canonical_key)).map(r=>r.id);if(ids.length)await store.db.prepare(`UPDATE job_catalog SET archived=1 WHERE id IN (${ids.map(()=>'?').join(',')})`).run(...ids);cursor=page.at(-1).id;}
  snapshots.delete(store);
}
export async function importWorkspaceCatalog(store,plan,config={}) {
  let cursor=0,total=0;
  for(;;){const rows=await store.db.prepare('SELECT body,rowid AS cursor FROM job_listings WHERE rowid>? ORDER BY rowid LIMIT 250').all(cursor);if(!rows.length)break;const result=await putCatalogJobs(rows.map(r=>JSON.parse(r.body)),plan,store,config);total+=result.count;if(result.paused)return result;cursor=Number(rows.at(-1).cursor);}
  await store.db.prepare("INSERT INTO directory_sync(id,status,body,updated_at) VALUES('catalog','completed',?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,body=excluded.body,updated_at=excluded.updated_at").run(JSON.stringify({imported:total,scope:plan.scope}),Date.now());
  await compactWorkspace(store,plan);return {imported:total};
}
export async function rescoreCatalog(task,store,queue,plan) {
  if(task.payload.scope!==plan.scope)return {status:'cancelled'};
  const rows=await store.db.prepare('SELECT id,canonical_key,body FROM job_catalog WHERE scope<>? ORDER BY id LIMIT 250').all(plan.scope);
  const result=await putCatalogJobs(rows.map(decode),plan,store);if(result.paused)return {status:'paused',rescored:0};
  if(rows.length===250)await queue.enqueue('catalog.rescore',{scope:plan.scope,part:(task.payload.part || 0)+1},{dedupeKey:`catalog-rescore:${plan.scope}:${(task.payload.part || 0)+1}`,runAt:1});
  return {rescored:rows.length};
}
export async function scheduleCatalog(store,queue,config={},plan=buildSearchPlan(store.state)) {
  if(config.JOB_CATALOG_ENABLED!=='true' || store.state.isDemo)return;
  const row=await store.db.prepare("SELECT status,body FROM directory_sync WHERE id='catalog'").get();
  if(row?.status!=='completed')await queue.enqueue('catalog.import',{}, {dedupeKey:'catalog-import-v1',runAt:0,maxAttempts:3});
  else {if(JSON.parse(row.body).scope!==plan.scope){await queue.enqueue('catalog.rescore',{scope:plan.scope,part:0},{dedupeKey:`catalog-rescore:${plan.scope}:0`});await store.db.prepare("UPDATE directory_sync SET body=?,updated_at=? WHERE id='catalog'").run(JSON.stringify({...JSON.parse(row.body),scope:plan.scope}),Date.now());}}
  const directory=await store.db.prepare("SELECT updated_at FROM directory_sync WHERE id='directories'").get();
  if(!directory || Number(directory.updated_at)<Date.now()-7*86400000)await queue.enqueue('directory.sync',{}, {dedupeKey:`directory-sync:${Math.floor(Date.now()/(7*86400000))}`,runAt:1,maxAttempts:2});
}
