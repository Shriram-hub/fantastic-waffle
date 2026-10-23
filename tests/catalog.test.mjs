import {taskQueue} from '../server/queue.mjs';
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
import {companyDirectory,filterCompanies,lookupCompanies,probeCompany,companyDossier,startCompanyAction,fetchCompanyJobs} from '../server/services/company-explorer.mjs';
test('company job searches retain compact descriptions and restore full detail from bounded source-cache chunks',async t=>{
  const {hydrateJobDetail}=await import('../server/services/job-details.mjs'),store=openStore(':memory:');t.after(()=>store.close());await store.replace(initialState(false));store.state.profile.interests=['Financial Analyst'];store.state.companyExplorer={companies:[{id:'company-action',name:'Newco',domain:'',boards:[{source:'Lever',slug:'newco',confirmed:true}]}],runs:[{id:'company-run',companyId:'company-action',status:'queued'}]};await store.save();
  const result=await fetchCompanyJobs({id:'company-task',payload:{companyId:'company-action',runId:'company-run'}},store,taskQueue(store),{},async url=>String(url).includes('api.lever.co')?new Response(JSON.stringify(Array.from({length:12},(_,i)=>({id:String(i),text:'Financial Analyst',categories:{location:'Mumbai'},hostedUrl:`https://jobs.lever.co/newco/${i}`,descriptionPlain:'Excel forecasting and cash flow. '.repeat(500)})))):new Response('Unavailable',{status:403}));
  assert.equal(result.found,1);assert.equal(store.state.jobs.length,1);assert.equal(store.state.jobs[0].description.length,280);const full=await hydrateJobDetail(store.state.jobs[0],store);assert.ok(full.description.length>1000);assert.equal(store.state.companyExplorer.runs[0].status,'completed');
});
test('company probes preserve official career links but never associate a guessed same-name board with the employer',async t=>{
  const store=openStore(':memory:');t.after(()=>store.close());await store.replace(initialState(false));store.state.companyExplorer={companies:[{id:'probe-company',name:'Newco',domain:'newco.com',boards:[],locations:['Global'],source:'Public source'}],runs:[]};await store.save();const queue=taskQueue(store);
  await probeCompany({payload:{companyId:'probe-company'}},store,queue,{},async url=>String(url).includes('boards-api.greenhouse.io')?new Response(JSON.stringify({jobs:[{id:1,title:'Engineer',absolute_url:'https://boards.greenhouse.io/newco/jobs/1',location:{name:'Remote'},content:'A role.'}]})):new Response('Unavailable',{status:404}),{page:async url=>({url,text:String(url).endsWith('robots.txt')?'':'<a href="https://jobs.lever.co/newco">Careers</a>'})});
  const company=store.state.companyExplorer.companies[0];assert.ok(company.boards.some(b=>b.source==='Lever' && b.confirmed));assert.ok(company.boards.some(b=>b.source==='Greenhouse' && !b.confirmed && b.status==='needs-review'));
  const registered=await store.db.prepare('SELECT source FROM discovered_boards').all();assert.ok(registered.some(b=>b.source==='Lever'));assert.ok(!registered.some(b=>b.source==='Greenhouse'));assert.equal(store.state.jobs.length,0);
});
test('company actions enqueue work without fetching on the request, and dossiers cite only observed hiring and saved people',async t=>{
  const store=openStore(':memory:');t.after(()=>store.close());await store.replace(initialState(false));const queue=taskQueue(store),directory=await companyDirectory(store,{q:'Lazard'}),company=directory.companies.find(c=>c.name==='Lazard');
  const first=await startCompanyAction({companyId:company.id,action:'jobs'},store,queue),second=await startCompanyAction({companyId:company.id,action:'jobs'},store,queue);assert.equal(first.task.kind,'company.jobs');assert.equal(second.existing,true);assert.equal(store.state.campaigns.length,0);
  store.state.jobs=[job('brief',{company:'Lazard',title:'Financial Analyst'})];store.state.contacts=[{id:'person',name:'Hiring manager',company:'Lazard',title:'Finance Manager',emailStatus:'unverified',suppressed:false}];store.state.companyExplorer.companies=[{...company,description:'A public company description.',source:'Wikipedia / Wikidata',reference:'https://en.wikipedia.org/wiki/Lazard'}];await store.save();
  const dossier=await companyDossier({jobId:'brief'},store,queue,{},()=>assert.fail('Saved public facts should be reused'));assert.equal(dossier.role,'Financial Analyst');assert.ok(dossier.hiringFocus.includes('Financial Analyst'));assert.equal(dossier.contacts[0].emailStatus,'unverified');assert.ok(dossier.sources.includes('https://en.wikipedia.org/wiki/Lazard'));assert.ok(dossier.questions.some(q=>q.includes('Financial Analyst')));
});
test('company directory supports real sector/city filters and 500+ employer references without loading the global catalogue',async t=>{
  const store=openStore(':memory:');t.after(()=>store.close());
  const rows=[{name:'Bank',domain:'bank.test',sector:'Fintech & Banking',locations:['Mumbai']},{name:'Software',domain:'soft.test',sector:'Enterprise SaaS & AI',locations:['Bangalore','Remote']}];
  assert.equal(filterCompanies(rows,{sector:'Fintech & Banking',city:'Mumbai'}).length,1);assert.equal(filterCompanies(rows,{q:'soft',city:'Bengaluru'})[0].name,'Software');assert.equal(filterCompanies(rows,{q:'no match'}).length,0);
  const directory=await companyDirectory(store,{q:'Lazard',sector:'Investment Banking & PE'});assert.ok(directory.curatedCount>=500);assert.ok(directory.companies.some(c=>c.name==='Lazard'));assert.ok(directory.companies[0].boards[0].reference);
  const jobs=store.state.jobs.length;await companyDirectory(store,{q:'100%_literal'});assert.equal(store.state.jobs.length,jobs);
});
test('free company lookup degrades on autocomplete failure, sources official website from Wikidata and caches results',async t=>{
  const store=openStore(':memory:');t.after(()=>store.close());const queue=taskQueue(store),calls=[];
  const fetcher=async value=>{const url=String(value);calls.push(url);if(url.includes('clearbit'))return new Response('gone',{status:404});if(url.includes('wikidata'))return new Response(JSON.stringify({entities:{Q123:{claims:{P856:[{mainsnak:{datavalue:{value:'https://examplecompany.com'}}}]}}}}));if(url.includes('list=search'))return new Response(JSON.stringify({query:{search:[{pageid:1,title:'Example Company'}]}}));return new Response(JSON.stringify({query:{pages:{1:{title:'Example Company',extract:'Example Company develops business software.',pageprops:{wikibase_item:'Q123'}}}}}));};
  const found=await lookupCompanies('Example Company',store,queue,fetcher);assert.equal(found.companies[0].domain,'examplecompany.com');assert.match(found.companies[0].reference,/wikipedia/);assert.ok(found.warnings.length);const count=calls.length;
  const again=await lookupCompanies('Example Company',store,queue,fetcher);assert.equal(again.cached,true);assert.equal(calls.length,count);assert.equal((await queue.list()).filter(t=>t.kind==='company.probe').length,1);assert.equal(store.state.campaigns.length,0);
});
