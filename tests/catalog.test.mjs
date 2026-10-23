import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {openStore} from '../server/store.mjs';
import {initialState} from '../server/fixtures.mjs';
import {buildSearchPlan} from '../server/services/search-plan.mjs';
import {putCatalogJobs,catalogJob,queryCatalog,importWorkspaceCatalog,compactWorkspace,retainCatalogJob,archiveMissingCatalogJobs,CATALOG_CAPACITY,WORKSPACE_JOB_LIMIT} from '../server/services/job-catalog.mjs';
const job=(id,fields={})=>({id,title:'Financial Analyst',company:`Company ${id}`,url:`https://company.com/jobs/${id}`,description:'Excel forecasting and financial reporting',source:'Greenhouse',board:'company',location:'Mumbai, India',workMode:'On-site',tags:['Excel'],isDemo:false,archived:false,...fields});
function clean(t){const store=openStore(':memory:');store.replace(initialState(false));t.after(()=>store.close());return store;}
const planFor=store=>buildSearchPlan(store.state,{roles:['Financial Analyst'],location:'Mumbai',country:'IN',workMode:'Any'});

test('catalogue deduplicates across sources, keeps stable IDs after edits and marks truncated text for detailed workflows',async t=>{
  const store=clean(t),plan=planFor(store),first=job('original',{description:'Excel '.repeat(100)});
  await putCatalogJobs([first],plan,store);await putCatalogJobs([{...first,id:'copy',source:'Lever'}],plan,store);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM job_catalog').get().n,1);
  assert.equal((await catalogJob('original',store)).descriptionTruncated,true);assert.equal((await catalogJob('original',store)).description.length,280);
  await putCatalogJobs([{...first,title:'Senior Financial Analyst'}],plan,store);assert.equal(store.db.prepare('SELECT count(*) AS n FROM job_catalog').get().n,1);assert.equal((await catalogJob('original',store)).title,'Senior Financial Analyst');
});

test('keyset cursors preserve ordering, enforce filters and scope, and escape literal search wildcards',async t=>{
  const store=clean(t),plan=planFor(store);await putCatalogJobs(Array.from({length:45},(_,i)=>job(`job-${String(i).padStart(3,'0')}`,{company:i===30?'Literal 100% firm':`Company ${i}`})),plan,store);
  const first=await queryCatalog(store,plan,{limit:20}),second=await queryCatalog(store,plan,{limit:20,cursor:first.nextCursor});assert.equal(first.total,45);assert.equal(second.jobs.length,20);assert.equal(new Set([...first.jobs,...second.jobs].map(j=>j.id)).size,40);
  assert.equal((await queryCatalog(store,plan,{q:'100%'})).total,1);assert.equal((await queryCatalog(store,plan,{source:'Lever'})).total,0);
  await assert.rejects(queryCatalog(store,plan,{q:'changed',cursor:first.nextCursor}),/different search/);
  await assert.rejects(queryCatalog(store,plan,{cursor:'invalid'}),/Invalid page cursor/);
  assert.equal(store.state.jobs.length,0,'Catalogued jobs never enter a workspace snapshot implicitly');
});

test('catalogue import trims the working set, preserves tracked jobs and materializes an older selected posting',async t=>{
  const store=clean(t),plan=planFor(store);store.state.jobs=Array.from({length:WORKSPACE_JOB_LIMIT+5},(_,i)=>job(`j-${i}`));store.state.applications=[{id:'saved',jobId:'j-1504',stage:'Saved'}];await store.save();
  const imported=await importWorkspaceCatalog(store,plan);assert.equal(imported.imported,1505);assert.ok(store.state.jobs.length<=WORKSPACE_JOB_LIMIT+1);assert.ok(store.state.jobs.some(j=>j.id==='j-1504'));
  const missing=store.db.prepare('SELECT id FROM job_catalog WHERE id NOT IN (SELECT id FROM job_listings) LIMIT 1').get().id;await retainCatalogJob(missing,store);assert.ok(store.state.jobs.some(j=>j.id===missing));
  store.state.applications.push({id:'retained',jobId:missing,stage:'Applied'});await store.save();await compactWorkspace(store,plan);assert.ok(store.state.jobs.some(j=>j.id===missing));assert.equal(store.state.applications.length,2);
});

test('only complete fresh native board responses archive missing catalogue postings',async t=>{
  const store=clean(t),plan=planFor(store);await putCatalogJobs([job('present'),job('closed')],plan,store);
  for(const descriptor of [{source:'Workday',board:'company',page:1},{source:'Greenhouse',board:'company',query:'Analyst'}])await archiveMissingCatalogJobs({descriptor,cached:false,jobs:[]},store);
  assert.ok(await catalogJob('closed',store));await archiveMissingCatalogJobs({descriptor:{source:'Greenhouse',board:'company'},cached:false,jobs:[job('present')]},store);
  assert.equal(await catalogJob('closed',store),null);assert.ok(await catalogJob('present',store));
});

test('a 250,000-row disk catalogue stays outside workspace memory and serves bounded pages at capacity',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'veloce-catalog-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=openStore(dir);store.replace(initialState(false));t.after(()=>store.close());const plan=planFor(store);
  store.db.exec('PRAGMA cache_size=-4096');
  const body=gzipSync(JSON.stringify(job('column-id-overrides-this'))).toString('base64');
  store.db.prepare("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<250000) INSERT INTO job_catalog(id,canonical_key,source,board,work_mode,search_terms,scope,score,tier,eligible,recommendable,archived,published_at,seen_at,body) SELECT printf('job-%06d',x),printf('key-%06d',x),'Greenhouse','company','On-site','financial analyst mumbai',?,80,'strong',1,1,0,0,0,? FROM n").run(plan.scope,body);
  await store.refresh();assert.equal(store.state.jobs.length,0);assert.equal(store.db.prepare('SELECT count(*) AS n FROM job_catalog').get().n,CATALOG_CAPACITY);
  const first=await queryCatalog(store,plan,{limit:20}),last=await queryCatalog(store,plan,{offset:249980,limit:20});assert.equal(first.total,250000);assert.equal(first.jobs[0].id,'job-000001');assert.equal(last.jobs.at(-1).id,'job-250000');
  assert.equal((await putCatalogJobs([job('beyond-capacity')],plan,store)).count,0);assert.equal(store.db.prepare('SELECT count(*) AS n FROM job_catalog').get().n,250000);
});
