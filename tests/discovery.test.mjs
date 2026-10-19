import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../server/store.mjs';
import {initialState} from '../server/fixtures.mjs';
import {taskQueue} from '../server/queue.mjs';
import {handlers,runOne} from '../server/worker.mjs';
import {createApp} from '../server/index.mjs';
import {saveSearchConfig,scheduleDiscovery,searchStatus,SOURCE_DEFAULTS,DISCOVERY_INTERVAL} from '../server/services/discovery.mjs';
import {buildSearchPlan,rankOpportunity} from '../server/services/search-plan.mjs';
import {fetchGoogleJobs} from '../server/providers/jobs/google-jobs.mjs';
import {knownBoards,rememberBoards} from '../server/providers/jobs/registry.mjs';
import {providerCall} from '../server/services/provider-budget.mjs';
import {parseResumeAsync} from '../server/resume.mjs';

const json=x=>new Response(JSON.stringify(x));
const sources=(...names)=>Object.fromEntries(Object.keys(SOURCE_DEFAULTS).map(k=>[k,names.includes(k)]));
const job=(title='Frontend Engineer',extra={})=>({id:'job-1',company:'Stripe',title,location:'Remote',workMode:'Remote',description:'React TypeScript interfaces',tags:['React'],url:'https://boards.greenhouse.io/stripe/jobs/1',source:'Greenhouse',board:'stripe',fetchedAt:new Date().toISOString(),...extra});
function clean(t) {const store=openStore(':memory:');t.after(()=>store.close());store.replace(initialState(false));return store;}
async function drain(store,queue,fetcher,config={}) {
  const registry=handlers(store,queue,config,fetcher);
  for(let i=0;i<180;i++) {const result=await runOne(store,queue,registry);if(!result) break;assert.equal(result.status,'completed',JSON.stringify(result));}
  await store.refresh();
}
test('job search starts from preferences without a resume, name, mailbox, contact key, or outreach consent',async t=>{
  const store=clean(t),queue=taskQueue(store);let calls=0;
  await saveSearchConfig({roles:['Frontend Engineer'],sources:sources('Remotive')},store,queue,{});
  assert.equal(store.state.resume,null);assert.equal(store.state.profile.name,'');
  const first=(await queue.list())[0];assert.equal(first.kind,'jobs.discover');
  assert.equal((await scheduleDiscovery(store,queue,{},true)).id,first.id,'An active run is reused');
  const fetcher=async url=>{calls++;assert.match(String(url),/remotive/);return json({jobs:Array.from({length:32},(_,i)=>({id:i,company_name:`Company ${i}`,title:'Frontend Engineer',candidate_required_location:'Remote',tags:['React'],url:`https://remotive.com/remote-jobs/software-dev/frontend-${i}`,description:'React and TypeScript interfaces'}))});};
  await drain(store,queue,fetcher);
  const status=await searchStatus(store);assert.equal(status.indexed,32);assert.equal(status.matches,32);assert.equal(status.run.status,'completed');
  assert.equal(store.state.applications.length,0);assert.equal(store.state.contacts.length,0);assert.equal(store.state.campaigns.length,0);
  assert.ok((await queue.list()).every(t=>t.kind==='jobs.discover'));
  assert.equal(await scheduleDiscovery(store,queue,{}),null);
  await scheduleDiscovery(store,queue,{},true);await drain(store,queue,fetcher);assert.equal(calls,1,'Manual refresh respects provider caches');
  assert.ok(status.schedule.next_run>Date.now()+DISCOVERY_INTERVAL-10000);
});
test('a multi-batch sweep indexes public feeds and all company boards, deduplicates and isolates a failed source',async t=>{
  const store=clean(t),queue=taskQueue(store),requests=[];let active=0,peak=0;
  await saveSearchConfig({roles:['Frontend Engineer'],sources:{...SOURCE_DEFAULTS,'Google Jobs':false}},store,queue,{});
  const fetcher=async input=>{
    const u=String(input);requests.push(u);
    active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));active--;
    if(u.includes('remotive.com')) return json({jobs:[{id:1,company_name:'Stripe',title:'Frontend Engineer',candidate_required_location:'Remote',url:'https://remotive.com/remote-jobs/stripe-1',description:'React TypeScript'},...Array.from({length:30},(_,i)=>({id:i+2,company_name:`Business ${i}`,title:i%2 ? 'Frontend Engineer' : 'Financial Analyst',candidate_required_location:'Worldwide',url:`https://remotive.com/remote-jobs/${i}`,description:'Financial modeling and React'}))]});
    if(u.includes('arbeitnow')) return new Response('{}',{status:503});
    if(u.includes('remoteok')) return json([]);
    if(u.includes('jobicy')) return json({jobs:[]});
    if(u.includes('himalayas')) return json({jobs:[]});
    if(u.includes('api.lever')) return json([]);
    if(u.includes('boards-api.greenhouse.io/v1/boards/stripe/')) return json({jobs:[{id:1,title:'Frontend Engineer',location:{name:'Remote'},absolute_url:'https://boards.greenhouse.io/stripe/jobs/1',content:'React TypeScript'}]});
    if(/greenhouse|ashby/.test(u)) return json({jobs:[]});
    throw Error('Unexpected external request');
  };
  await drain(store,queue,fetcher);
  const status=await searchStatus(store);assert.equal(status.run.status,'completed');assert.ok(status.run.details.sourcesChecked>=110);assert.ok(status.run.details.failed>=1);
  assert.equal(store.state.jobs.filter(j=>j.company==='Stripe').length,1);assert.equal(status.indexed,31);assert.equal(status.matches,16);
  assert.equal(status.sources.find(s=>s.source==='Arbeitnow').status,'unavailable');
  assert.ok(store.state.jobs.filter(j=>j.title==='Financial Analyst').every(j=>!j.archived),'Other fields remain in the index, available under All live jobs');
  assert.ok(!requests.some(u=>u.endsWith('/stripe/jobs')),'Curated boards do not need a second validation request');
  assert.ok(!requests.some(u=>/api\.(apollo|hunter|resend)\./.test(u)));
  assert.ok(peak<=2,'Provider concurrency stays within the free-host memory budget');
});
test('resume-derived roles include finance, while country, experience and work-mode preferences filter unsuitable roles',()=>{
  const state=initialState(false);state.resume={text:'Financial modeling, valuation, bookkeeping and accounting. Built dashboards in Power BI.',suggestions:{skills:['Excel','Financial modeling']}};
  const plan=buildSearchPlan(state,{country:'IN',experience:'Entry level',workMode:'Remote'});
  assert.ok(plan.roles.includes('Financial Analyst'));assert.ok(plan.roles.includes('Accountant'));
  assert.equal(rankOpportunity(job('Frontend Engineer'),plan).eligible,false);
  assert.equal(rankOpportunity(job('Financial Analyst',{description:'Financial modeling Excel',locationRestrictions:['India']}),plan).eligible,true);
  assert.equal(rankOpportunity(job('Senior Financial Analyst'),plan).eligible,false);
  assert.equal(rankOpportunity(job('Financial Analyst',{locationRestrictions:['United States']}),plan).eligible,false);
  assert.equal(rankOpportunity(job('Financial Analyst',{location:'London',workMode:'On-site'}),plan).eligible,false);
});
test('optional Google Jobs normalizes real apply links from both aggregators; provider quota failure leaves free discovery working',async t=>{
  const [serp]=await fetchGoogleJobs('Frontend Engineer',{SERPAPI_API_KEY:'test'},async input=>{assert.equal(new URL(input).searchParams.get('engine'),'google_jobs');return json({jobs_results:[{job_id:'s1',title:'Frontend Engineer',company_name:'Stripe',location:'Remote',description:'React',apply_options:[{title:'LinkedIn',link:'https://linkedin.com/jobs/view/123'},{title:'Stripe careers',link:'https://boards.greenhouse.io/stripe/jobs/1'}]}]});});
  assert.equal(serp.applyOptions.length,2);assert.equal(serp.source,'Google Jobs');assert.equal(serp.url,'https://linkedin.com/jobs/view/123');
  const [rapid]=await fetchGoogleJobs('Analyst',{JSEARCH_API_KEY:'test'},async(input,options)=>{assert.equal(options.headers['X-RapidAPI-Key'],'test');return json({data:[{job_id:'j1',job_title:'Analyst',employer_name:'Company',job_country:'India',job_apply_link:'https://company.com/jobs/1',job_description:'Analyze finances'}]});});
  assert.equal(rapid.title,'Analyst');assert.equal(rapid.url,'https://company.com/jobs/1');
  const store=clean(t),queue=taskQueue(store);
  await saveSearchConfig({roles:['Analyst'],sources:sources('Google Jobs','Remotive')},store,queue,{});
  await drain(store,queue,async input=>String(input).includes('remotive') ? json({jobs:[]}) : new Response('{}',{status:429}),{JSEARCH_API_KEY:'test',SERPAPI_API_KEY:'test',JOB_SEARCH_API_DAILY_LIMIT:'1'});
  const status=await searchStatus(store);assert.equal(status.run.status,'completed');assert.equal(status.sources.find(s=>s.source==='Remotive').status,'healthy');
  assert.equal((await store.db.prepare('SELECT count(*) AS count FROM provider_requests').get()).count,1);
});
test('parallel provider reservations are serialized and contact and search budgets are independent',async t=>{
  const store=clean(t);let requests=0;
  const results=await Promise.allSettled([providerCall(store,'a','JSearch',1,async()=>{requests++;return []; }),providerCall(store,'b','SerpApi',1,async()=>{requests++;return [];})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(requests,1);
  await providerCall(store,'c','Apollo',1,async()=>{requests++;return [];});assert.equal(requests,2);
});
test('a hosted fresh workspace bootstraps discovery, and source changes supersede an old search scope',async t=>{
  const store=clean(t),queue=taskQueue(store);
  assert.equal(await scheduleDiscovery(store,queue,{}),null);
  assert.ok(await scheduleDiscovery(store,queue,{DISCOVERY_BOOTSTRAP:'true'}));
  await saveSearchConfig({roles:['Accountant'],sources:sources('Arbeitnow')},store,queue,{});
  const tasks=await Promise.all((await queue.list()).map(t=>queue.get(t.id)));assert.equal(tasks.filter(t=>t.kind==='jobs.discover').length,2);
  const scope=buildSearchPlan(store.state,(await searchStatus(store)).preferences).scope;
  const old=tasks.find(t=>t.payload.scope!==scope);
  const done=await runOne(store,queue,handlers(store,queue,{},()=>{throw Error('Old scope must not fetch');}),old.id);
  assert.equal(done.status,'cancelled');
});
test('bootstrap exposes setup booleans, not secrets; run endpoint only enqueues and job details retain full text',async t=>{
  const store=clean(t);store.state.jobs=[job('Frontend Engineer',{description:'React '.repeat(300)})];await store.save();
  const config={APOLLO_API_KEY:'never-return-apollo',JSEARCH_API_KEY:'never-return-search',WORKSPACE_PASSWORD:'owner',DISCOVERY_BOOTSTRAP:'true'};
  const app=createApp({store,config,fetcher:()=>{throw Error('Request path must not call providers');}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  t.after(async()=>{app.events.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));});
  const base=`http://127.0.0.1:${app.server.address().port}`,headers={Authorization:`Basic ${Buffer.from('orbit:owner').toString('base64')}`,'Content-Type':'application/json'};
  assert.equal((await fetch(base+'/api/bootstrap')).status,401);
  const response=await fetch(base+'/api/bootstrap',{headers}),raw=await response.text(),data=JSON.parse(raw);
  assert.ok(!raw.includes('never-return'));assert.equal(data.setup.jsearchConfigured,true);assert.ok(data.data.jobs[0].description.length<300);
  const detail=await (await fetch(base+'/api/jobs/job-1',{headers})).json();assert.equal(detail.job.description.length,1800);
  assert.equal((await fetch(base+'/api/autopilot/run',{method:'POST',headers,body:'{}'})).status,202);
  assert.ok((await app.queue.list()).some(t=>t.kind==='jobs.discover'));
});
test('PDF text and skills extract on native hosting without Poppler',async()=>{
  const content='BT /F1 12 Tf 40 740 Td (Casey Quinn - React and SQL engineer) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  let pdf='%PDF-1.4\n';const offsets=[0];
  for(const [i,object] of objects.entries()) {offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;}
  const start=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  const originalPath=process.env.PATH;
  try {
    process.env.PATH='/__orbit_test_without_poppler__';
    const parsed=await parseResumeAsync({name:'resume.pdf',base64:Buffer.from(pdf).toString('base64')});
    assert.match(parsed.resume.text,/Casey Quinn/);assert.ok(parsed.suggestions.skills.includes('React'));assert.ok(parsed.suggestions.skills.includes('SQL'));assert.equal(parsed.warning,'');
  } finally {process.env.PATH=originalPath;}
});
test('new ATS apply links expand the persistent board registry only after a successful JSON probe',async t=>{
  const store=clean(t),queue=taskQueue(store),listing=job('Frontend Engineer',{company:'New Company',url:'https://jobs.ashbyhq.com/orbit-new-company/role-1',source:'Google Jobs'});
  await rememberBoards([listing],store,queue);assert.equal((await knownBoards(store)).length,0);
  let probes=0;await drain(store,queue,async input=>{probes++;assert.equal(String(input),'https://api.ashbyhq.com/posting-api/job-board/orbit-new-company');return json({jobs:[]});});
  assert.equal((await knownBoards(store))[0].slug,'orbit-new-company');
  await rememberBoards([listing],store,queue);await drain(store,queue,()=>{throw Error('Already checked');});assert.equal(probes,1);
});
