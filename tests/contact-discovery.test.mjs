import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../server/store.mjs';
import {initialState} from '../server/fixtures.mjs';
import {taskQueue} from '../server/queue.mjs';
import {handlers,runOne} from '../server/worker.mjs';
import {startContactDiscovery,contactDiscoveryStatus} from '../server/services/contact-discovery.mjs';
import {searchHunter,searchHunterCompany} from '../server/providers/contacts/hunter.mjs';
import {searchApollo} from '../server/providers/contacts/apollo.mjs';
import {verifyWorkEmail} from '../server/providers/contacts/verification.mjs';
import {createApp} from '../server/index.mjs';
import {publicCompanyPages} from '../server/providers/contacts/public-pages.mjs';
import {parseCSV,normalizeContact} from '../server/domain.mjs';
import {checkContactProviders} from '../server/services/contact-provider-checks.mjs';

const response=data=>new Response(JSON.stringify(data)),mx=async()=>[{exchange:'mx.company.test'}];
async function personal(t){const store=openStore(':memory:');t.after(()=>store.close());await store.replace(initialState(false));return store;}
const publicPages=async domain=>[{url:`https://${domain}/careers`,text:`Apply to hr&#64;${domain} or jobs@${domain}. Do not use jobs@elsewhere.com.`}];

test('Hunter filters at the provider, preserves sources and recent verification, and rejects mismatched company domains',async()=>{
  const fetcher=async url=>{const u=new URL(url);assert.equal(u.searchParams.get('department'),'hr,executive');assert.equal(u.searchParams.get('limit'),'10');return response({data:{domain:'company.com',organization:'Company',accept_all:false,emails:[{value:'riley@company.com',first_name:'Riley',position:'Recruiter',department:'hr',verification:{status:'valid',date:new Date().toISOString()},sources:[{uri:'https://company.com/team',last_seen_on:'2026-10-20'}]},{value:'ceo@company.com',position:'CEO',department:'executive',verification:{status:'accept_all',date:new Date().toISOString()}},{value:'bad@elsewhere.com',department:'hr',verification:{status:'valid',date:new Date().toISOString()}}]}});};
  const contacts=await searchHunter('company.com','test-only',5,fetcher);assert.equal(contacts.length,2);assert.equal(contacts[0].emailStatus,'verified');assert.equal(contacts[0].verification.reference,'https://company.com/team');assert.equal(contacts[1].emailStatus,'catch-all');
  await assert.rejects(searchHunter('company.com','test',3,async()=>response({data:{domain:'other.com',emails:[]}})),/different company/);
  const name=await searchHunterCompany('Company Ltd','test',3,fetcher);assert.equal(name.company.domain,'company.com');
  assert.equal((await searchHunterCompany('Unrelated','test',3,fetcher)).company,null);
});
test('Hunter current valid status works without deprecated result; blocked, webmail, catch-all and stale search claims stay excluded',async()=>{
  assert.equal((await verifyWorkEmail('riley@company.com',{HUNTER_API_KEY:'test'},async(_u,options)=>{assert.equal(options.signal.aborted,false);return response({data:{status:'valid',accept_all:false}});},mx)).emailStatus,'verified');
  for(const fields of [{accept_all:true},{webmail:true},{block:true},{disposable:true}])assert.notEqual((await verifyWorkEmail('riley@company.com',{HUNTER_API_KEY:'test'},async()=>response({data:{status:'valid',...fields}}),mx)).emailStatus,'verified');
  const contacts=await searchHunter('company.com','test',3,async()=>response({data:{emails:[{value:'hr@company.com',department:'hr',verification:{status:'valid',date:'2020-01-01'}}]}}));assert.equal(contacts[0].emailStatus,'unverified');
});
test('Apollo errors explain key, access and quota restrictions without exposing keys or provider bodies',async()=>{
  for(const [status,pattern] of [[401,/key was rejected/],[403,/work email/],[429,/quota/]]) {
    await assert.rejects(searchApollo({domain:'company.com'},'never-log-this',async()=>new Response('never-log-this private-provider-body',{status})),error=>{assert.match(error.message,pattern);assert.ok(!error.message.includes('never-log'));assert.ok(!error.message.includes('private-provider-body'));assert.equal(error.status,502);return true;});
  }
});
test('public-only batch deduplicates domains, retains job-safe sources, never calls Apollo/Hunter, and never queues mail',async t=>{
  const store=await personal(t),queue=taskQueue(store),config={};
  const result=await store.run(()=>startContactDiscovery({source:'domains',domains:['company.com','company.com','other.com'],contactsPerCompany:2},store,queue,config));assert.equal(result.run.targets.length,2);
  const duplicate=await store.run(()=>startContactDiscovery({source:'domains',domains:['company.com','other.com'],contactsPerCompany:2},store,queue,config));assert.equal(duplicate.existing,true);
  const registry=handlers(store,queue,config,async()=>assert.fail('No paid API request allowed'),{lookupMx:mx,contactPages:publicPages});
  while((await queue.list()).some(t=>t.status==='queued'))assert.equal((await runOne(store,queue,registry)).status,'completed');
  await store.refresh();assert.equal(store.state.contacts.length,4);assert.ok(store.state.contacts.every(c=>c.emailStatus==='unverified' && c.companyDomain===c.email.split('@')[1] && c.verification.reference.endsWith('/careers')));
  assert.equal(store.state.campaigns.length,0);assert.equal(store.db.prepare('SELECT count(*) AS n FROM provider_requests').get().n,0);assert.ok((await contactDiscoveryStatus(store)).runs[0].targets.every(t=>t.status==='completed'));
});
test('Hunter failure falls through to real public contacts and the held request is not charged again',async t=>{
  const store=await personal(t),queue=taskQueue(store),config={HUNTER_API_KEY:'test'};let calls=0;
  const fetcher=async url=>{assert.match(String(url),/api.hunter.io/);calls++;return new Response('{}',{status:403});};
  for(let i=0;i<2;i++) {
    const {run}=await store.run(()=>startContactDiscovery({source:'domains',domains:['company.com'],allowCredits:true,contactsPerCompany:1},store,queue,config));
    const done=await runOne(store,queue,handlers(store,queue,config,fetcher,{lookupMx:mx,contactPages:publicPages}),run.targets[0].taskId);assert.equal(done.status,'completed');
  }
  await store.refresh();assert.equal(store.state.contacts.length,1);assert.equal(store.state.contacts[0].emailStatus,'unverified');assert.equal(calls,2); // One failed search and one failed verification, both held.
  assert.ok(store.state.contactDiscoveryRuns[0].targets[0].warnings.length);assert.equal(store.state.campaigns.length,0);
});
test('batch limits, cancelled searches, suppression and shared daily budgets remain enforced',async t=>{
  const store=await personal(t),queue=taskQueue(store),config={HUNTER_API_KEY:'test',CONTACT_API_DAILY_LIMIT:'1'};
  await assert.rejects(startContactDiscovery({source:'domains',domains:['gmail.com']},store,queue),/corporate domains/);
  await assert.rejects(startContactDiscovery({source:'domains',domains:['company.com'],companyLimit:51},store,queue),/1–50/);
  const {run}=await store.run(()=>startContactDiscovery({source:'domains',domains:['company.com'],allowCredits:true,contactsPerCompany:1},store,queue,config));
  await queue.cancel(run.targets[0].taskId);await store.refresh();assert.equal((await contactDiscoveryStatus(store,config)).runs[0].targets[0].status,'cancelled');
  const next=await store.run(()=>startContactDiscovery({source:'domains',domains:['company.com'],allowCredits:true,contactsPerCompany:1},store,queue,config));assert.ok(!next.existing);
  store.state.contacts.push({id:'suppressed',email:'hr@company.com',suppressed:true,isDemo:false,emailStatus:'unverified'});await store.save();
  let calls=0;const fetcher=async()=>{calls++;return response({data:{domain:'company.com',emails:[]}});};
  await runOne(store,queue,handlers(store,queue,config,fetcher,{lookupMx:mx,contactPages:publicPages}),next.run.targets[0].taskId);await store.refresh();assert.equal(calls,1);assert.equal(store.state.contacts.find(c=>c.id==='suppressed').suppressed,true);assert.equal(store.db.prepare('SELECT count(*) AS n FROM provider_requests').get().n,1);
});
test('contact discovery and CSV export require owner auth; CSV neutralizes formulas and includes provenance',async t=>{
  const store=await personal(t),app=createApp({store,config:{WORKSPACE_PASSWORD:'test',ENABLE_JOB_DISCOVERY:'false'}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{app.events.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));});
  const base=`http://127.0.0.1:${app.server.address().port}`,headers={Authorization:`Basic ${Buffer.from('orbit:test').toString('base64')}`,'Content-Type':'application/json'};
  assert.equal((await fetch(base+'/api/contacts/discovery')).status,401);assert.equal((await fetch(base+'/api/export/contacts')).status,401);
  store.state.contacts.push({id:'csv',name:'=IMPORTXML("bad")',email:'hr@company.com',company:'Company',title:'Recruiter',source:'Public company careers',emailStatus:'unverified',verification:{reference:'https://company.com/careers'}});await store.save();
  const csv=await (await fetch(base+'/api/export/contacts',{headers})).text();assert.match(csv,/'=IMPORTXML/);assert.match(csv,/Reference/);assert.match(csv,/https:\/\/company.com\/careers/);
  const noConsent=await fetch(base+'/api/contacts/verify-batch',{method:'POST',headers,body:JSON.stringify({ids:['csv']})});assert.equal(noConsent.status,400);
});
test('a missing robots file allows bounded public pages while blocked robots stops discovery',async()=>{
  let calls=0;const pages=await publicCompanyPages('company.com',{load:async url=>{calls++;if(url.endsWith('/robots.txt'))throw Object.assign(Error('Missing'),{httpStatus:404});return {url,text:'Published recruiting page'};}});
  assert.equal(pages.length,4);assert.equal(calls,5);
  calls=0;assert.deepEqual(await publicCompanyPages('company.com',{load:async()=>{calls++;throw Object.assign(Error('Blocked'),{httpStatus:403});}}),[]);assert.equal(calls,1);
});
test('provider CSV aliases preserve people and company fields without trusting a valid label as verified',()=>{
  const rows=parseCSV('First Name,Last Name,Work Email,Company Name,Job Title,Verification\nRiley,Quinn,riley@company.com,Company,Recruiter,valid');
  const contact=normalizeContact(rows[0]);assert.equal(contact.name,'Riley Quinn');assert.equal(contact.company,'Company');assert.equal(contact.title,'Recruiter');assert.equal(contact.emailStatus,'unverified');
});
test('matching-role batches resolve exact Hunter companies and keep the discovered job attached without Apollo',async t=>{
  const store=await personal(t),queue=taskQueue(store),config={HUNTER_API_KEY:'test'};
  store.state.profile.interests=['Financial Analyst'];store.state.profile.skills=['Excel'];store.state.jobs=[{id:'finance',company:'New Company',title:'Financial Analyst',description:'Excel financial modelling and valuation',tags:['Excel'],location:'Mumbai',workMode:'On-site',source:'Company',url:'https://jobs.lever.co/new/1',archived:false,isDemo:false},{id:'other',company:'Unrelated',title:'Principal Backend Engineer',description:'Python',tags:['Python'],location:'Mumbai',workMode:'On-site',source:'Company',url:'https://jobs.lever.co/other/1',archived:false,isDemo:false}];await store.save();
  const result=await store.run(()=>startContactDiscovery({source:'matches',allowCredits:true,companyLimit:5,contactsPerCompany:1},store,queue,config));assert.equal(result.run.targets.length,1);
  let hunterCalls=0;const fetcher=async url=>{if(String(url).includes('clearbit.com'))return response([]);const u=new URL(url);assert.equal(u.hostname,'api.hunter.io');assert.equal(u.searchParams.get('company'),'New Company');hunterCalls++;return response({data:{domain:'newcompany.com',organization:'New Company Ltd',emails:[{value:'hr@newcompany.com',department:'hr',verification:{status:'valid',date:new Date().toISOString()}}]}});};
  const done=await runOne(store,queue,handlers(store,queue,config,fetcher,{lookupMx:mx,contactPages:async()=>[]}),result.run.targets[0].taskId);assert.equal(done.status,'completed');await store.refresh();assert.equal(hunterCalls,1);assert.equal(store.state.contacts[0].jobId,'finance');assert.equal(store.state.contacts[0].jobTitle,'Financial Analyst');assert.equal(store.state.contacts[0].emailStatus,'verified');assert.equal(store.state.campaigns.length,0);
});
test('free provider checks report endpoint errors and cache safe summaries without credits or account identity',async t=>{
  const store=await personal(t);let calls=0;
  const config={APOLLO_API_KEY:'private-apollo-key',HUNTER_API_KEY:'private-hunter-key'},fetcher=async url=>{calls++;if(String(url).includes('apollo.io'))return new Response('private-apollo-key',{status:403});assert.match(String(url),/account-stats/);return response({data:{email:'private-owner@candidate.com',plan_name:'Free'}});};
  const result=await checkContactProviders(store,config,fetcher);assert.equal(result.checks[0].httpStatus,403);assert.equal(result.checks[1].ok,true);assert.equal(calls,2);
  await checkContactProviders(store,config,fetcher);assert.equal(calls,2);assert.equal(store.db.prepare('SELECT count(*) AS n FROM provider_requests').get().n,0);assert.equal(store.state.contacts.length,0);
  const body=JSON.stringify(result);for(const secret of ['private-apollo-key','private-hunter-key','private-owner@candidate.com'])assert.ok(!body.includes(secret));
});
