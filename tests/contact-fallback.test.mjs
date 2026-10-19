import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../server/store.mjs';
import {initialState} from '../server/fixtures.mjs';
import {taskQueue} from '../server/queue.mjs';
import {handlers,runOne} from '../server/worker.mjs';
import {savePolicy} from '../server/services/autopilot-policy.mjs';
import {permuteEmails} from '../server/providers/contacts/permutator.mjs';
import {findPublicContacts,xrayPeople,publishedContacts} from '../server/providers/contacts/free-xray.mjs';
import {publicIPv4,robotsAllows} from '../server/providers/contacts/public-pages.mjs';
import {normalizeContact,campaignFingerprint} from '../server/domain.mjs';
import {queueCampaign} from '../server/services/outreach.mjs';
import {ingestMessage} from '../server/services/inbox.mjs';

const mx=async()=>[{priority:10,exchange:'mx.test.invalid'}];
test('public fallback collects real published recruiting addresses; names and patterns stay unverified',async()=>{
  const pages=async()=>[{url:'https://company.com/careers',text:'Contact jobs@company.com. Sales sales@company.com. Other jobs@elsewhere.com.'}];
  const contacts=await findPublicContacts({company:'Company',url:'https://company.com/jobs/1',description:''},{domain:'company.com'},{pages,fetcher:()=>{throw Error('No paid API');}});
  assert.equal(contacts.length,1);assert.equal(contacts[0].email,'jobs@company.com');assert.equal(contacts[0].emailStatus,'unverified');assert.equal(contacts[0].verification.reference,'https://company.com/careers');
  const people=xrayPeople([{title:'Riley Quinn - Technical Recruiter at Company | LinkedIn',link:'https://www.linkedin.com/in/rileyquinn',snippet:'Technical Recruiter at Company'},{title:'Unrelated Person - CTO at Other',link:'https://linkedin.com/in/other',snippet:'CTO Other'}],'Company','company.com');
  assert.equal(people.length,1);assert.equal(people[0].firstName,'Riley');
  const candidates=permuteEmails(people[0]);assert.equal(candidates.length,5);assert.equal(candidates[0].email,'riley.quinn@company.com');assert.ok(candidates.every(c=>c.emailStatus==='unverified'));
  assert.deepEqual(permuteEmails({...people[0],companyDomain:'linkedin.com'}),[]);
  assert.equal(publishedContacts('jobs@unrelated.com','company.com','https://company.com','Company').length,0);
});
test('public-page fetches reject private addresses and respect robots exclusions',()=>{
  for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','0.0.0.0','::1','198.18.0.1','224.0.0.1']) assert.equal(publicIPv4(ip),false,ip);
  assert.equal(publicIPv4('1.1.1.1'),true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\nAllow: /careers','/careers'),true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /careers','/careers'),false);
});
for(const cached of [false,true]) test(`contact waterfall ${cached ? 'reuses verified company cache without provider credits' : 'saves free public candidates without auto-mailing them'}`,async t=>{
  const store=openStore(':memory:');t.after(()=>store.close());const state=initialState(false);
  Object.assign(state.profile,{name:'Casey Quinn',email:'casey@candidate.com',skills:['React'],interests:['Frontend Engineer'],workMode:'Remote'});
  state.resume={name:'resume.txt',text:'Casey Quinn built React interfaces.',base64:Buffer.from('Casey Quinn built React interfaces.').toString('base64')};
  state.jobs=[{id:'job-1',company:'Stripe',title:'Frontend Engineer',source:'Greenhouse',board:'stripe',url:'https://boards.greenhouse.io/stripe/jobs/1',description:'React',workMode:'Remote',location:'Remote',tags:[],archived:false,isDemo:false}];
  if(cached) state.contacts=[{...normalizeContact({name:'Riley Quinn',email:'recruiting@stripe.com',company:'Stripe',title:'Recruiter',email_status:'verified'},'Verified cache')}];
  // Existing company links must exist before relational contacts are stored.
  await store.replace(state);const queue=taskQueue(store),p=await savePolicy({enabled:true,acknowledged:true,freeContactFallback:!cached,allowContactCredits:false,contactsPerCompany:1},store,{});
  await store.db.prepare("INSERT INTO autopilot_runs(id,job_id,policy_id,status,body,updated_at) VALUES('run-1','job-1',?,'discovered','{}',?)").run(p.id,Date.now());
  const task=await queue.enqueue('AUTO_ENRICH_COMPANY',{runId:'run-1',policyId:p.id});
  const registry=handlers(store,queue,{},()=>{throw Error('Paid API must not run');},{lookupMx:mx,contactPages:async()=>[{url:'https://stripe.com/careers',text:'Email recruiting@stripe.com'}]});
  const result=await runOne(store,queue,registry,task.id);assert.equal(result.status,'completed');await store.refresh();
  assert.equal(store.state.contacts.length,1);assert.equal(store.state.contacts[0].emailStatus,cached ? 'verified' : 'unverified');
  const run=await store.db.prepare('SELECT status FROM autopilot_runs').get();assert.equal(run.status,cached ? 'enriched' : 'blocked');
  assert.equal((await queue.list()).filter(t=>t.kind==='AUTO_DRAFT_PERSONALIZED_EMAIL').length,cached ? 1 : 0);
  assert.equal(store.state.campaigns.length,0);
});
test('company cooldown caps initial outreach across campaigns, and scheduling staggers messages',async t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-19T09:00:00Z')});
  const store=openStore(':memory:');t.after(()=>store.close());const s=initialState(false);
  Object.assign(s.profile,{name:'Casey Quinn',email:'casey@candidate.com'});
  s.contacts=Array.from({length:4},(_,i)=>normalizeContact({name:`Recruiter ${i}`,email:`recruiter${i}@company.com`,company:'Company',email_status:'verified'},'Verified import'));
  const make=(id,ids)=>({id,name:'Campaign',contactIds:ids,subject:'A relevant opportunity',body:'Hello {{first_name}}, I am {{my_name}}.',deliveries:[],status:'Draft'});
  s.campaigns=[make('first',s.contacts.slice(0,3).map(c=>c.id)),make('fourth',[s.contacts[3].id])];
  for(const c of s.campaigns) s.previews[c.id]={campaignId:c.id,expires:Date.now()+600000,fingerprint:campaignFingerprint(c,s)};
  await store.replace(s);const queue=taskQueue(store),config={ENABLE_LIVE_SEND:'true',RESEND_API_KEY:'test',EMAIL_FROM:'casey@candidate.com'};
  await queueCampaign(store.state.campaigns[0],{previewId:'first',approved:true,confirmCount:3},store,queue,config);
  const booked=(await queue.list()).filter(t=>t.kind==='campaign.send').map(t=>t.run_at).sort();assert.equal(booked.length,3);
  assert.ok(booked[1]-booked[0]>=3*60000);assert.ok(booked[2]-booked[1]>=3*60000);
  await assert.rejects(queueCampaign(store.state.campaigns[1],{previewId:'fourth',approved:true,confirmCount:1},store,queue,config),/14-day contact limit/);
  assert.equal((await queue.list()).filter(t=>t.kind==='campaign.send').length,3,'Failed approval does not leave a partially queued send');
});
test('a real recipient reply cancels company follow-ups even in a new thread',async t=>{
  const store=openStore(':memory:');t.after(()=>store.close());const s=initialState(false),queue=taskQueue(store);
  s.contacts=[{id:'one',email:'recruiter@company.com'},{id:'two',email:'manager@company.com'}];
  await store.replace(s);
  const one=await queue.enqueue('campaign.followup',{}, {runAt:Date.now()+86400000}),two=await queue.enqueue('campaign.followup',{}, {runAt:Date.now()+86400000});
  store.state.campaigns=[{id:'campaign',status:'Accepted by provider',deliveries:[{contactId:'one',threadId:'old',followupTaskId:one.id},{contactId:'two',threadId:'other',followupTaskId:two.id}]}];await store.save();
  await ingestMessage({id:'reply',from:'recruiter@company.com',subject:'Thanks',body:'Thanks for reaching out.',threadId:'brand-new-thread',receivedAt:new Date().toISOString()},store);
  assert.equal((await queue.get(one.id)).status,'cancelled');assert.equal((await queue.get(two.id)).status,'cancelled');
  assert.ok(store.state.campaigns[0].deliveries.every(d=>d.followupStopped));
});
