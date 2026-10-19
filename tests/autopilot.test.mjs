import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {openStore} from '../server/store.mjs';
import {openPostgresStore} from '../server/db/postgres-store.mjs';
import {initialState} from '../server/fixtures.mjs';
import {taskQueue} from '../server/queue.mjs';
import {handlers,runOne} from '../server/worker.mjs';
import {createApp} from '../server/index.mjs';
import {getPolicy,savePolicy,profileScope} from '../server/services/autopilot-policy.mjs';
import {ensureSearchMatrix,scheduleAutopilot,SWEEP_INTERVAL,reviewAutopilot,approveReview,retryHeldLookups,scoreDiscoveredJob} from '../server/services/autopilot.mjs';
import {providerCall} from '../server/services/provider-budget.mjs';
import {resolveCompany} from '../server/providers/contacts/company.mjs';
import {verifyWorkEmail,emailCandidates} from '../server/providers/contacts/verification.mjs';
import {fetchHimalayas} from '../server/providers/jobs/himalayas.mjs';

const response = data => new Response(JSON.stringify(data));
const mx = async () => [{priority:10,exchange:'mx.test.invalid'}];
const config={APOLLO_API_KEY:'mock-only',RESEND_API_KEY:'mock-only',EMAIL_FROM:'casey@candidate.com',ENABLE_LIVE_SEND:'true',PUBLIC_BASE_URL:'https://orbit.test'};
async function personal(store) {
  const s=initialState(false);
  s.profile={...s.profile,name:'Casey Quinn',email:'casey@candidate.com',skills:['React','TypeScript'],interests:['Frontend Engineer'],workMode:'Remote',location:'London'};
  s.resume={name:'resume.txt',base64:Buffer.from('Casey Quinn\nBuilt React and TypeScript interfaces.').toString('base64'),text:'Casey Quinn\nBuilt React and TypeScript interfaces.'};
  await store.replace(s);return store;
}
async function enable(store,approvalMode='review') {
  return savePolicy({enabled:true,acknowledged:true,allowContactCredits:true,approvalMode,contactsPerCompany:2,timeZone:'UTC'},store,config);
}
function providerMock() {
  const calls=[];
  const fetcher=async (input,options={})=>{
    const url=String(input);calls.push(url);
    if(url.includes('boards-api.greenhouse.io')) return response({jobs:url.includes('/stripe/') ? [{id:1,title:'Frontend Engineer',location:{name:'Remote'},absolute_url:'https://boards.greenhouse.io/stripe/jobs/1',content:'Build React and TypeScript interfaces.',updated_at:'2026-10-19T08:00:00Z'}] : []});
    if(url.includes('remotive.com')) return response({jobs:[]});
    if(url.includes('arbeitnow.com')) return response({data:[]});
    if(url.includes('himalayas.app')) return response({jobs:[]});
    if(url.includes('api.ashbyhq.com')) return response({jobs:[]});
    if(url.includes('api.lever.co')) return response([]);
    if(url.includes('/mixed_people/api_search')) {const payload=JSON.parse(options.body);assert.deepEqual(payload.q_organization_domains_list,['stripe.com']);assert.equal(payload.per_page,2);return response({people:[{id:'p1',first_name:'Riley',last_name_obfuscated:'Q...',title:'Technical Recruiter'},{id:'p2',first_name:'Jordan',last_name_obfuscated:'S...',title:'Engineering Manager'}]});}
    if(url.includes('/people/match')) {const payload=JSON.parse(options.body);assert.equal(payload.reveal_personal_emails,false);return response({person:{name:payload.id==='p1'?'Riley Test':'Jordan Test',title:'Technical Recruiter',email:`${payload.id}@stripe.com`,email_status:'verified',organization:{name:'Stripe',primary_domain:'stripe.com'}}});}
    if(url==='https://api.resend.com/emails') return response({id:'mock-message'});
    throw Error(`Unexpected test network request: ${url}`);
  };
  return {calls,fetcher};
}
async function prepare(store,queue,p,fetcher,steps=3) {
  const task=await store.run(()=>scheduleAutopilot(store,queue,config));
  assert.ok(task);
  const registry=handlers(store,queue,config,fetcher,{lookupMx:mx,contactPages:async()=>[]});
  for(let i=0;i<steps;i++) {
    const done=await runOne(store,queue,registry);
    assert.equal(done?.status,'completed',JSON.stringify(done));
  }
  await store.refresh();return registry;
}
test('Autopilot is off by default; résumé facts produce a persistent, revisable search matrix without network access',async t=>{
  const store=await personal(openStore(':memory:'));t.after(()=>store.close());const queue=taskQueue(store);
  assert.equal((await getPolicy(store)).enabled,false);
  assert.equal(await scheduleAutopilot(store,queue,config),null);
  const matrix=await ensureSearchMatrix(store,{},()=>{throw Error('No AI consent');});
  assert.deepEqual(matrix.target_roles,['Frontend Engineer']);assert.ok(matrix.ats_boards_to_watch.length>=100);
  assert.deepEqual(matrix.locations,['London','Remote']);
  assert.deepEqual(await ensureSearchMatrix(store),matrix);
  store.state.profile.interests=['Data Analyst'];await store.save();
  assert.deepEqual((await ensureSearchMatrix(store)).target_roles,['Data Analyst']);
  await assert.rejects(savePolicy({enabled:true},store,config),/Acknowledge/);
});
test('cloud ticks and worker restarts reserve only one discovery sweep per two-hour interval',async t=>{
  const store=await personal(openStore(':memory:'));t.after(()=>store.close());const queue=taskQueue(store);
  await enable(store);
  const clock=Date.now(),first=await scheduleAutopilot(store,queue,config,clock);
  assert.ok(first);assert.equal(await scheduleAutopilot(store,queue,config,clock+1000),null);
  assert.equal(await scheduleAutopilot(store,queue,config,clock+SWEEP_INTERVAL-1),null);
  const next=await scheduleAutopilot(store,queue,config,clock+SWEEP_INTERVAL);
  assert.notEqual(first.id,next.id);assert.equal((await queue.list()).length,2);
});
for(const kind of ['sqlite','postgres']) test(`${kind}: autonomous discovery links jobs and verified contacts, then waits for batch review before any send`,async t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-19T09:00:00Z')});
  let store,pg;
  if(kind==='postgres') {
    pg=new PGlite();t.after(()=>pg.close());
    const query=async(sql,params=[])=>{if(!params.length && sql.includes(';')){const r=(await pg.exec(sql)).at(-1);return {rows:r?.rows||[],rowCount:r?.affectedRows||0};}const r=await pg.query(sql,params);return {rows:r.rows,rowCount:r.affectedRows||0};};
    store=await openPostgresStore({}, {query,async connect(){return {query,release(){}};},async end(){}});
  } else {store=openStore(':memory:');t.after(()=>store.close());}
  await personal(store);const queue=taskQueue(store),p=await store.run(()=>enable(store)),mock=providerMock();
  const registry=await prepare(store,queue,p,mock.fetcher);
  assert.equal(store.state.jobs.length,1);assert.equal(store.state.applications[0].stage,'Saved');assert.equal(store.state.contacts.length,2);
  const contact=await store.db.prepare('SELECT job_id,company_domain FROM contacts LIMIT 1').get();
  assert.equal(contact.job_id,store.state.jobs[0].id);assert.equal(contact.company_domain,'stripe.com');
  assert.equal(mock.calls.filter(u=>u.includes('api.resend.com')).length,0);
  const review=await reviewAutopilot(store);assert.equal(review.messages.length,2);
  assert.match(review.messages[0].body,/Frontend Engineer/);assert.match(review.messages[0].body,/\/r\//);
  assert.ok(!review.messages[0].body.includes('Q...'));
  await assert.rejects(store.run(()=>approveReview({approved:true,confirmCount:2,fingerprint:'stale'},store,queue,config)),/changed/);
  const future=await queue.enqueue('campaign.followup',{accountId:'resend'}, {runAt:Date.now()+4*86400000});
  await store.run(()=>approveReview({approved:true,confirmCount:2,fingerprint:review.fingerprint},store,queue,config));
  const sends=(await queue.list()).filter(t=>t.kind==='campaign.send');assert.equal(sends.length,2);
  assert.ok(sends.every(s=>s.max_attempts===1));
  const scheduled=sends.map(s=>s.run_at).sort();assert.ok(scheduled[1]-scheduled[0]>=180000);
  assert.equal(scheduled[0],Date.now(),'A future follow-up must not block today’s available sending slots.');
  assert.equal((await runOne(store,queue,registry,sends.find(s=>s.run_at===scheduled[0]).id)).status,'completed');
  assert.equal(mock.calls.filter(u=>u.includes('api.resend.com')).length,1);
  await store.run(()=>savePolicy({enabled:false},store,config));
  const remaining=sends.find(s=>s.run_at===scheduled[1]);
  t.mock.timers.tick(scheduled[1]-Date.now());
  assert.equal((await runOne(store,queue,registry,remaining.id)).status,'cancelled');
  assert.equal(mock.calls.filter(u=>u.includes('api.resend.com')).length,1);
  assert.equal((await store.db.prepare('SELECT status FROM outreach_send_log WHERE task_id=?').get(remaining.id)).status,'cancelled');
  // Reset order also respects the new company/job foreign keys.
  await store.replace(initialState(false));
});
test('Full Autopilot needs explicit live-send setup and queues only under the current profile policy',async t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-19T09:00:00Z')});
  const store=await personal(openStore(':memory:'));t.after(()=>store.close());const queue=taskQueue(store);
  await assert.rejects(savePolicy({enabled:true,acknowledged:true,allowContactCredits:true,approvalMode:'automatic'},store,{}),/Apollo|Hunter|Live sending/);
  const p=await enable(store,'automatic'),mock=providerMock(),registry=await prepare(store,queue,p,mock.fetcher);
  assert.equal((await queue.list()).filter(t=>t.kind==='campaign.send').length,2);
  assert.equal(mock.calls.filter(u=>u.includes('api.resend.com')).length,0);
  store.state.profile.summary='Changed after preparing.';await store.save();
  const send=(await queue.list()).find(t=>t.kind==='campaign.send' && t.run_at<=Date.now());
  assert.equal((await runOne(store,queue,registry,send.id)).status,'cancelled');
  assert.equal(mock.calls.filter(u=>u.includes('api.resend.com')).length,0);
});
test('provider reservations cap API calls and hold ambiguous lookups instead of charging them twice',async t=>{
  const store=openStore(':memory:');t.after(()=>store.close());let calls=0;
  assert.deepEqual(await providerCall(store,'one','Apollo',2,async()=>{calls++;return {id:'p1'};}),{id:'p1'});
  await providerCall(store,'one','Apollo',2,async()=>{calls++;});assert.equal(calls,1);
  await assert.rejects(providerCall(store,'two','Apollo',2,async()=>{calls++;throw Error('Disconnected');}),/Disconnected/);
  await assert.rejects(providerCall(store,'two','Apollo',2,async()=>{calls++;}),/held/);
  await assert.rejects(providerCall(store,'three','Hunter',2,async()=>{calls++;}),/limit/);
  assert.equal(calls,2);
});
test('a reconciled provider lookup keeps the original budget entry and requires explicit retry consent',async t=>{
  const store=await personal(openStore(':memory:'));t.after(()=>store.close());const queue=taskQueue(store);
  await enable(store);
  await assert.rejects(providerCall(store,'key','Apollo',5,async()=>{throw Error('Connection lost');}));
  const held=await store.db.prepare("SELECT id FROM provider_requests WHERE status='held'").get();
  await assert.rejects(retryHeldLookups({ids:[held.id]},store,queue),/Confirm/);
  await retryHeldLookups({ids:[held.id],approved:true},store,queue);
  assert.equal((await store.db.prepare("SELECT count(*) AS count FROM provider_requests WHERE status='reconciled'").get()).count,1);
  let calls=0;
  await providerCall(store,'key','Apollo',5,async()=>{calls++;return {ok:true};});assert.equal(calls,1);
  assert.equal((await store.db.prepare('SELECT count(*) AS count FROM provider_requests').get()).count,2);
});
test('discovery filters explicit seniority, on-site location, and country restrictions before starting outreach',async t=>{
  const store=await personal(openStore(':memory:'));t.after(()=>store.close());const matrix=await ensureSearchMatrix(store);
  const job={title:'Frontend Engineer',description:'React TypeScript',location:'Remote',workMode:'Remote',tags:[]};
  assert.ok(scoreDiscoveredJob(job,store.state,matrix).score>=80);
  assert.equal(scoreDiscoveredJob({...job,title:'Senior Frontend Engineer'},store.state,matrix).score,0);
  assert.equal(scoreDiscoveredJob({...job,locationRestrictions:['United States']},store.state,matrix,{country:'IN'}).score,0);
  assert.equal(scoreDiscoveredJob({...job,locationRestrictions:['India']},store.state,matrix).score,0);
  assert.ok(scoreDiscoveredJob({...job,locationRestrictions:['India']},store.state,matrix,{country:'IN'}).score>=80);
});
test('company ambiguity, guessed addresses, catch-all verification and missing credits never yield sendable contacts',async t=>{
  assert.equal(await resolveCompany({company:'Acme Unlisted'},async()=>response([{name:'Acme Unlisted',domain:'one.co'},{name:'Acme Unlisted',domain:'two.co'}])),null);
  assert.equal(await resolveCompany({company:'Acme Unlisted'},async()=>response([{name:'Acme Unlisted Labs',domain:'one.co'}])),null);
  const candidates=emailCandidates('Riley','Quinn','company.com');assert.equal(candidates.length,3);assert.ok(candidates.every(c=>c.emailStatus==='unverified'));
  assert.equal((await verifyWorkEmail(candidates[0].email,{},()=>{throw Error('No verifier key');},mx)).emailStatus,'unverified');
  const store=await personal(openStore(':memory:'));t.after(()=>store.close());const queue=taskQueue(store),mock=providerMock();
  await savePolicy({enabled:true,acknowledged:true},store,{});
  await prepare(store,queue,await getPolicy(store),mock.fetcher,2);
  assert.equal(store.state.contacts.length,0);assert.equal(store.state.campaigns.length,0);
  assert.ok(!(mock.calls.some(u=>u.includes('apollo.io'))));
});
test('Himalayas preserves attribution/restrictions and the scheduler endpoint requires its separate credential',async t=>{
  const [job]=await fetchHimalayas('React',{},async()=>response({jobs:[{guid:'1',title:'React Developer',companyName:'Company',locationRestrictions:['India'],timezoneRestrictions:[5.5],applicationLink:'https://himalayas.app/companies/company/jobs/react',description:'React interfaces',pubDate:1792396800}]}));
  assert.equal(job.source,'Himalayas');assert.deepEqual(job.locationRestrictions,['India']);assert.match(job.url,/himalayas/);
  const store=await personal(openStore(':memory:')),app=createApp({store,config:{WORKSPACE_PASSWORD:'test-owner',AUTOPILOT_CRON_SECRET:'test-scheduler'}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  t.after(async()=>{app.events.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));store.close();});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  assert.equal((await fetch(base+'/api/autopilot')).status,401);
  assert.equal((await fetch(base+'/api/internal/autopilot/tick',{method:'POST'})).status,401);
  const valid=await fetch(base+'/api/internal/autopilot/tick',{method:'POST',headers:{'X-Orbit-Scheduler':'test-scheduler'}});
  assert.equal(valid.status,202);const status=await valid.json();assert.equal(status.version,'0.5.0');assert.equal(status.storage,'sqlite');assert.ok(!Object.values(status.setup).some(Boolean));
});
