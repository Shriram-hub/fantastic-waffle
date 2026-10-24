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
import {contactTargeting,reportingTargets,prioritizeContact,classifyJobField} from '../server/services/contact-personas.mjs';
import {activeHiringPeople,searchCompanyPeople,findPublicContacts} from '../server/providers/contacts/free-xray.mjs';
import {learnEmailPattern,permuteEmails} from '../server/providers/contacts/permutator.mjs';
import {observeCompanyEmails,companyPattern} from '../server/services/company-patterns.mjs';
import {searchHunterDomain} from '../server/providers/contacts/hunter.mjs';
import {ingestMessage} from '../server/services/inbox.mjs';
import {saveProviderKey} from '../server/services/provider-config.mjs';
import {findCompanyContacts} from '../server/services/contact-discovery.mjs';
import {serperSearch,tavilySearch} from '../server/providers/contacts/serper-xray.mjs';
import {searchProspeoDomain,findProspeoEmail} from '../server/providers/contacts/prospeo.mjs';
import {findGetProspectEmail} from '../server/providers/contacts/getprospect.mjs';
import {searchMineleadDomain} from '../server/providers/contacts/minelead.mjs';
import {githubCommitContacts} from '../server/providers/contacts/github-commits.mjs';
import {discoverBulkBatch} from '../server/services/bulk-harvest.mjs';

const response=data=>new Response(JSON.stringify(data)),mx=async()=>[{exchange:'mx.company.test'}];
async function personal(t){const store=openStore(':memory:');t.after(()=>store.close());await store.replace(initialState(false));return store;}
const publicPages=async domain=>[{url:`https://${domain}/careers`,text:`Apply to hr&#64;${domain} or jobs@${domain}. Do not use jobs@elsewhere.com.`}];

test('Hunter accepts a trimmed workspace-state key and dirty domains, and persists provider-reported formats without inventing samples',async t=>{
  for(const domain of ['https://www.HDFCBANK.com/careers/',' www.HDFCBANK.com/careers ','hdfcbank.com']){
    const result=await searchHunterDomain(domain,{connections:{hunterApiKey:' saved-key '}},1,async input=>{const u=new URL(input);assert.equal(u.searchParams.get('domain'),'hdfcbank.com');assert.equal(u.searchParams.get('api_key'),'saved-key');assert.equal(u.searchParams.get('department'),null);return response({data:{domain:'hdfcbank.com',pattern:'{first}.{last}',emails:[]}});});assert.equal(result.pattern,'{first}.{last}');
  }
  const store=await personal(t),config={TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,4).toString('base64'),HUNTER_API_KEY:'wrong-server-key'};await saveProviderKey('hunter','saved-key',store,config);
  await findCompanyContacts({company:'HDFC Bank',title:'Analyst'},{domain:'hdfcbank.com'},{store,config,allowCredits:true,allowPublic:false,lookupMx:mx,fetcher:async input=>{assert.equal(new URL(input).searchParams.get('api_key'),'saved-key');return response({data:{domain:'hdfcbank.com',pattern:'{first}.{last}',emails:[]}});}});
  const saved=await companyPattern(store,'hdfcbank.com');assert.equal(saved.pattern,'{first}.{last}');assert.equal(saved.providerPattern.sampleCount,0);assert.equal(saved.providerPattern.mailboxVerified,false);
});

test('Serper and Tavily normalize source links, use server-side headers, and retain actual people instead of fabricating records',async()=>{
  const result={title:'Maya Singh - Finance Director at Company | LinkedIn',link:'https://www.linkedin.com/in/maya-singh',snippet:'Director at Company'};
  const serper=await serperSearch('Company people',{connections:{serperApiKey:' serper-test '}},{fetcher:async(url,options)=>{assert.equal(url,'https://google.serper.dev/search');assert.equal(options.headers['X-API-KEY'],'serper-test');assert.equal(JSON.parse(options.body).num,20);return response({organic:[result,{link:'javascript:bad'}],credits:1});}});
  assert.equal(serper.results.length,1);assert.equal(serper.creditsUsed,1);
  const tavily=await tavilySearch('Company people','tavily-test',{fetcher:async(url,options)=>{assert.equal(options.headers.Authorization,'Bearer tavily-test');assert.equal(JSON.parse(options.body).include_raw_content,false);return response({results:[{...result,url:result.link,content:result.snippet}]});}});assert.equal(tavily.results[0].link,result.link);
  const found=await searchCompanyPeople('Company','company.com',{allowSearch:true,freeSearch:false,config:{SERPER_API_KEY:'test'},call:(_p,fn)=>fn(),fetcher:async()=>response({organic:[result]})});assert.equal(found.people[0].name,'Maya Singh');assert.equal(found.people[0].email,undefined);
});

test('Prospeo and GetProspect use current documented endpoints and only explicit mailbox verification qualifies',async()=>{
  const person={name:'Maya Singh',linkedinUrl:'https://www.linkedin.com/in/maya-singh'};
  const search=await searchProspeoDomain('company.com','prospeo-test',15,async(url,options)=>{assert.equal(url,'https://api.prospeo.io/search-person');assert.equal(options.headers['X-KEY'],'prospeo-test');assert.deepEqual(JSON.parse(options.body).filters.company.websites.include,['company.com']);return response({results:[{person:{person_id:'p1',full_name:person.name,linkedin_url:person.linkedinUrl,current_job_title:'Director of Finance'}}]});});assert.equal(search.contacts[0].emailStatus,'unverified');assert.equal(search.contacts[0].person_id,'p1');
  const found=await findProspeoEmail(search.contacts[0],'company.com','prospeo-test',async(url,options)=>{assert.equal(url,'https://api.prospeo.io/enrich-person');const b=JSON.parse(options.body);assert.equal(b.enrich_mobile,false);assert.equal(b.only_verified_email,true);return response({person:{full_name:person.name,email:{revealed:true,email:'maya.singh@company.com',status:'VERIFIED'}}});});assert.equal(found.emailStatus,'verified');
  assert.equal(await findProspeoEmail(person,'company.com','test',async()=>response({person:{email:{revealed:true,email:'maya@unrelated.com',status:'VERIFIED'}}})),null);
  for(const [domain_status,status] of [['valid','verified'],['accept_all','catch-all']]){
    const p=await findGetProspectEmail(person,'company.com','getprospect-test',async(url,options)=>{assert.equal(url,'https://api.getprospect.com/v2/email/find');assert.equal(options.headers['x-api-key'],'getprospect-test');assert.deepEqual(JSON.parse(options.body),{data:{full_name:person.name,domain:'company.com'}});return response({success:true,data:{email:'maya@company.com',status:'valid',domain_status}});});assert.equal(p.emailStatus,status);
  }
});

test('Minelead quality scores and real GitHub commit addresses stay unverified; unrelated organizations and noreply mailboxes are excluded',async()=>{
  const minelead=await searchMineleadDomain('company.com','minelead-test',10,async input=>{const u=new URL(input);assert.equal(u.searchParams.get('key'),'minelead-test');return response({pattern:'{first}.{last}@company.com',emails:[{name:'Maya Singh',email:'maya.singh@company.com',quality:100},{email:'hr@company.com',verification:{status:'valid'}},{email:'x@elsewhere.com',quality:100}]});});
  assert.equal(minelead.pattern,'{first}.{last}');assert.equal(minelead.contacts.length,2);assert.equal(minelead.contacts[0].emailStatus,'unverified');assert.equal(minelead.contacts[1].emailStatus,'verified');
  const github=await githubCommitContacts({name:'Company',domain:'company.com',githubOrg:'company'},{fetcher:async input=>{const path=new URL(input).pathname;if(path==='/orgs/company')return response({blog:'https://company.com'});if(path.endsWith('/repos'))return response([{name:'open-project',fork:false,private:false}]);return response([{html_url:'https://github.com/company/open-project/commit/1',commit:{author:{name:'Maya Singh',email:'maya.singh@company.com'},committer:{name:'GitHub',email:'noreply@github.com'}}}]);}});assert.equal(github.length,1);assert.equal(github[0].emailStatus,'unverified');assert.equal(github[0].emailObserved,true);
  assert.deepEqual(await githubCommitContacts({domain:'company.com',githubOrg:'wrong'},{fetcher:async()=>response({blog:'https://elsewhere.com'})}),[]);
});

test('bulk-harvest API returns a deduplicated background task, discovers companies concurrently and never queues mail',async t=>{
  const store=await personal(t),app=createApp({store,config:{WORKSPACE_PASSWORD:'test',ENABLE_JOB_DISCOVERY:'false'}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{app.events.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));});
  const url=`http://127.0.0.1:${app.server.address().port}/api/contacts/bulk-harvest`,headers={'Content-Type':'application/json',Authorization:`Basic ${Buffer.from('orbit:test').toString('base64')}`},body=JSON.stringify({source:'companies',companies:'company.com,other.com,company.com',contactsPerCompany:5,companyLimit:25});
  assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body})).status,401);
  const first=await fetch(url,{method:'POST',headers,body});assert.equal(first.status,202);const {run}=await first.json();assert.equal(run.targets.length,2);
  assert.equal((await (await fetch(url,{method:'POST',headers,body})).json()).existing,true);
  let active=0,peak=0;const queue=app.queue,task=await queue.get(run.taskId);
  await store.run(()=>discoverBulkBatch(task,store,queue,{},async()=>assert.fail('No external provider calls in this test'),{findCompanyContacts:async(_job,company)=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,10));active--;return {contacts:[{name:'Maya Singh',title:'Director of Finance',companyDomain:company.domain,email:`maya@${company.domain}`,emailStatus:'unverified',source:'Public source'}],warnings:[]};}}));
  await store.refresh();assert.equal(peak,2);assert.equal(store.state.contacts.length,2);assert.ok(store.state.contactDiscoveryRuns[0].targets.every(t=>t.status==='completed' && t.verified===0));assert.ok((await queue.list()).every(t=>t.kind==='contacts.bulk'));assert.equal(store.state.campaigns.length,0);
});

test('field personas weight functional leaders first, preserve specialist recruiters and peers, and prefer the actual role over preferences',()=>{
  for(const title of ['Financial Analyst','Investment Banking Analyst','Accountant']) {
    const target=contactTargeting({title},{roles:['Software Engineer']});assert.equal(target.field,'finance');assert.deepEqual(target.personas.map(p=>p.weight),[60,25,15]);
    for(const term of ['VP Finance','Head of FP&A','Managing Director'])assert.ok(target.personas[0].titles.includes(term));
    assert.ok(target.personas[1].titles.includes('Finance Recruiter'));
    assert.ok(prioritizeContact({title:'VP Finance'},target).priorityScore>prioritizeContact({title:'Recruiter'},target).priorityScore);
  }
  for(const [title,field] of [['AI Engineer','software'],['Head of Product Design','product'],['Growth Marketing Analyst','marketing'],['Strategy Consultant','consulting']])assert.equal(classifyJobField({title}),field);
  assert.equal(classifyJobField({title:'Associate',department:'Corporate Finance'}),'finance');
});
test('reporting lines and source-supplied posting authors lead public people queries without inventing identities',async()=>{
  const job={title:'Financial Analyst',company:'Company',url:'https://company.com/jobs/1',description:'Reporting to the Director of Corporate Development. You will build models. Work closely with our CFO on the budget.',postedBy:{name:'Riley Patel',url:'https://linkedin.com/in/riley-patel'}};
  const targeting=contactTargeting(job);assert.deepEqual(reportingTargets(job).map(r=>r.value),['Riley Patel','Director of Corporate Development','CFO']);
  assert.deepEqual(reportingTargets({description:'You will report to a supportive team.'}),[]);
  const queries=[];
  await searchCompanyPeople('Company','company.com',{job,targeting,allowSearch:true,freeSearch:false,config:{SERPAPI_API_KEY:'fake'},call:async(_provider,fn)=>fn(),fetcher:async input=>{queries.push(new URL(input).searchParams.get('q'));return response({organic_results:[]});}});
  assert.ok(queries.some(q=>q.includes('"Director of Corporate Development"') && q.indexOf('"Riley Patel"')<q.indexOf('"VP Finance"')));
  assert.ok(queries.some(q=>q.includes('site:linkedin.com/posts') && q.includes('Financial Analyst')));
});
test('hiring-post authors have an evidenced +25 signal; posting about a company never establishes employment or a guessed mailbox',async()=>{
  const result={link:'https://www.linkedin.com/posts/riley_hiring-activity-1',title:'Riley Patel on LinkedIn: We are hiring a Financial Analyst at Company',snippet:'Join my team at Company'};
  const [poster]=activeHiringPeople([result],'Company','company.com',contactTargeting({title:'Financial Analyst'}));
  assert.equal(poster.activeHiringPoster,true);assert.equal(poster.email,'');assert.equal(poster.employerSupported,false);assert.ok(poster.hiringPost.quote.includes('hiring'));
  assert.equal(poster.priorityScore,40);assert.equal(activeHiringPeople([{...result,title:'Company is hiring'}],'Company','company.com').length,0);
  const contacts=await findPublicContacts({title:'Financial Analyst',company:'Company',description:'',url:'https://company.com/jobs/1'},{domain:'company.com'},{pages:async()=>[],searchPeople:true,freeSearch:false,allowSearch:true,config:{SERPAPI_API_KEY:'fake'},call:async(_provider,fn)=>fn(),fetcher:async input=>response({organic_results:new URL(input).searchParams.get('q').includes('linkedin.com/posts')?[result]:[]})});
  assert.equal(contacts[0].email,'');assert.equal(contacts[0].activeHiringPoster,true);
});
test('named public or verified observations learn patterns across searches while guesses and conflicts stay unverified',async t=>{
  const store=await personal(t),contact={name:'Rahul Sharma',email:'rahul.sharma@company.com',source:'Public company team',emailStatus:'unverified',sources:[{url:'https://company.com/team'}]};
  const learned=learnEmailPattern([contact],'company.com');assert.equal(learned.pattern,'{first}.{last}');assert.equal(learned.status,'observed');assert.equal(learned.mailboxVerified,false);
  const next=learnEmailPattern([{...contact,name:'Asha Verma',email:'asha.verma@company.com'}],'company.com',learned);assert.equal(next.status,'corroborated');assert.equal(next.sampleCount,2);
  const mixed=learnEmailPattern([{...contact,name:'Jamie Jones',email:'jjones@company.com'}],'company.com',next);assert.equal(mixed.status,'mixed');
  assert.equal(learnEmailPattern([{...contact,source:'Unverified name pattern',emailInferred:true}],'company.com'),null);
  const [guess]=permuteEmails({firstName:'Maya',lastName:'Singh',companyDomain:'company.com',domainPattern:next.pattern});assert.equal(guess.email,'maya.singh@company.com');assert.equal(guess.emailStatus,'unverified');assert.equal(guess.confidence,undefined);
  await observeCompanyEmails(store,{domain:'company.com',name:'Company'},[contact]);await store.refresh();assert.equal((await companyPattern(store,'company.com')).learnedPattern.sampleCount,1);
  store.state.jobs=[{id:'pattern-job',company:'Company',companyDomain:'company.com',title:'Analyst',description:'',url:'https://company.com/jobs/1'}];await store.save();
  await ingestMessage({id:'pattern-mail',from:'"Asha Verma" <asha.verma@company.com>',subject:'Hello',body:'Thank you',receivedAt:new Date().toISOString()},store);
  assert.equal((await companyPattern(store,'company.com')).learnedPattern.status,'corroborated');
});
test('Hunter requests unfiltered results and ranks finance leadership instead of discarding non-HR people',async()=>{
  const targeting=contactTargeting({title:'Investment Banking Analyst'});
  const result=await searchHunterDomain('company.com','fake',10,async input=>{assert.equal(new URL(input).searchParams.get('department'),null);return response({data:{domain:'company.com',organization:'Company',emails:[{first_name:'Riley',last_name:'Patel',position:'Recruiter',department:'hr',value:'riley@company.com'},{first_name:'Maya',last_name:'Singh',position:'Head of FP&A',department:'finance',value:'maya@company.com'}]}});},targeting);
  assert.equal(result.contacts[0].name,'Maya Singh');assert.equal(result.contacts[0].persona,'manager');assert.equal(result.contacts[0].emailStatus,'unverified');
});

test('Hunter ranks unfiltered provider results, preserves sources and recent verification, and rejects mismatched company domains',async()=>{
  const fetcher=async url=>{const u=new URL(url);assert.equal(new URL(url).searchParams.get('department'),null);assert.equal(u.searchParams.get('limit'),'10');return response({data:{domain:'company.com',organization:'Company',accept_all:false,emails:[{value:'riley@company.com',first_name:'Riley',position:'Recruiter',department:'hr',verification:{status:'valid',date:new Date().toISOString()},sources:[{uri:'https://company.com/team',last_seen_on:'2026-10-20'}]},{value:'ceo@company.com',position:'CEO',department:'executive',verification:{status:'accept_all',date:new Date().toISOString()}},{value:'bad@elsewhere.com',department:'hr',verification:{status:'valid',date:new Date().toISOString()}}]}});};
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
  let calls=0;const fetcher=async url=>{if(!String(url).includes('api.hunter.io'))return new Response('blocked',{status:403});calls++;return response({data:{domain:'company.com',emails:[]}});};
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
  assert.equal(pages.length,7);assert.equal(calls,8);
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
  const config={APOLLO_API_KEY:'private-apollo-key',HUNTER_API_KEY:'private-hunter-key'},fetcher=async url=>{calls++;if(String(url).includes('apollo.io'))return new Response('private-apollo-key',{status:403});assert.match(String(url),/v2\/account\?/);return response({data:{email:'private-owner@candidate.com',plan_name:'Free'}});};
  const result=await checkContactProviders(store,config,fetcher);assert.equal(result.checks[0].httpStatus,403);assert.equal(result.checks[1].ok,true);assert.equal(calls,2);
  await checkContactProviders(store,config,fetcher);assert.equal(calls,2);assert.equal(store.db.prepare('SELECT count(*) AS n FROM provider_requests').get().n,0);assert.equal(store.state.contacts.length,0);
  const body=JSON.stringify(result);for(const secret of ['private-apollo-key','private-hunter-key','private-owner@candidate.com'])assert.ok(!body.includes(secret));
});
test('a daily-budget pause preserves contacts and resumes cached discovery without charging a second domain search',async t=>{
  const store=await personal(t),queue=taskQueue(store),config={HUNTER_API_KEY:'test',CONTACT_API_DAILY_LIMIT:'1'};let searches=0,verifications=0;
  const fetcher=async url=>{if(String(url).includes('domain-search')){searches++;return response({data:{domain:'company.com',emails:[{value:'hr@company.com',department:'hr'}]}});}if(!String(url).includes('email-verifier'))return new Response('blocked',{status:403});verifications++;return response({data:{status:'valid',accept_all:false}});};
  const {run}=await store.run(()=>startContactDiscovery({source:'domains',domains:['company.com'],contactsPerCompany:1,allowCredits:true},store,queue,config));
  const registry=handlers(store,queue,config,fetcher,{lookupMx:mx,contactPages:async()=>[]}),taskId=run.targets[0].taskId;
  const paused=await runOne(store,queue,registry,taskId);assert.equal(paused.status,'queued');assert.ok(paused.run_at>Date.now());await store.refresh();assert.equal(store.state.contacts[0].emailStatus,'unverified');assert.equal(store.state.contactDiscoveryRuns[0].targets[0].added,1);
  // Simulate the next local budget window, retaining the provider result cache.
  store.db.prepare("UPDATE provider_requests SET day='1999-01-01'").run();store.db.prepare('UPDATE tasks SET run_at=0 WHERE id=?').run(taskId);
  assert.equal((await runOne(store,queue,registry,taskId)).status,'completed');await store.refresh();assert.equal(searches,1);assert.equal(verifications,1);assert.equal(store.state.contacts[0].emailStatus,'verified');assert.equal(store.state.contactDiscoveryRuns[0].targets[0].added,1);
});

import {serperPeopleSearch} from '../server/providers/contacts/serper-xray.mjs';
import {personaQueries,duckDuckGoNext} from '../server/providers/contacts/free-xray.mjs';
import {checkContactDomains} from '../server/providers/contacts/dns.mjs';
import {queueBrowserContacts,importBrowserContacts} from '../server/services/browser-contacts.mjs';
import {CONTACT_CLUSTERS} from '../shared/contact-discovery.mjs';
const testName=i=>`Person ${String.fromCharCode(65+Math.floor(i/26))}${String.fromCharCode(65+i%26)}`;
const indexedPerson=(i,title='Director of Finance')=>({title:`${testName(i)} - ${title} at Company | LinkedIn`,link:`https://www.linkedin.com/in/person-${i}/?trk=search`,snippet:`${title} at Company`});

test('deep Serper pages collect 50–100 unique canonical profiles and stop on exhausted or repeated pages',async()=>{
  for(const targetCount of [50,100]){const pages=[],found=await serperPeopleSearch('Company finance people','test',{targetCount,fetcher:async(_url,init)=>{const b=JSON.parse(init.body);pages.push(b.page);assert.equal(b.num,50);return response({organic:Array.from({length:20},(_,i)=>indexedPerson((b.page-1)*20+i))});}});assert.equal(found.results.length,targetCount);assert.equal(new Set(found.results.map(p=>p.link)).size,targetCount);assert.ok(found.results.every(p=>!p.link.includes('?') && !p.link.endsWith('/')));assert.equal(pages.length,Math.ceil(targetCount/20));}
  let calls=0;const repeated=await serperPeopleSearch('Company','test',{targetCount:100,fetcher:async()=>{calls++;return response({organic:[indexedPerson(0)]});}});assert.equal(calls,2);assert.equal(repeated.results.length,1);
});
test('four parallel persona tiers paginate through overlap, rank by domain and keep 100 genuine profiles',async()=>{
  let active=0,peak=0;const queries=[],titles=['Managing Director','Finance Manager','Talent Acquisition Partner','Senior Financial Analyst'];
  const found=await searchCompanyPeople('Company','company.com',{targetCount:100,job:{title:'Financial Analyst'},allowSearch:true,freeSearch:false,config:{SERPER_API_KEY:'test'},call:(_p,fn)=>fn(),fetcher:async(_url,init)=>{const {q,page}=JSON.parse(init.body),tier=q.includes('"Managing Director"')?0:q.includes('"Team Lead"')?1:q.includes('"Talent Acquisition"')?2:3;queries.push({q,page});active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;return response({organic:Array.from({length:20},(_,i)=>indexedPerson(page===1?i:20+tier*20+i,titles[tier]))});}});
  assert.equal(found.people.length,100);assert.equal(peak,4);assert.deepEqual(new Set(found.people.map(p=>p.searchTier)),new Set(['executive','management','recruiting','specialist']));assert.equal(new Set(found.people.map(p=>p.name)).size,100);assert.ok(queries.some(q=>q.page===2));assert.ok(found.people.every(p=>!p.email));
  const generated=personaQueries('Company',contactTargeting({title:'Financial Analyst'}));assert.ok(generated.some(q=>q.q.includes('"Head of"')));assert.ok(generated.some(q=>q.q.includes('"Senior Consultant"')));
});
test('Brave uses page offsets 0,1 and honors exhaustion; DuckDuckGo follows bounded next-form fields',async()=>{
  const offsets=[];await searchCompanyPeople('Company','company.com',{targetCount:100,allowSearch:true,freeSearch:false,config:{BRAVE_SEARCH_API_KEY:'test'},call:(_p,fn)=>fn(),fetcher:async input=>{const u=new URL(input),offset=Number(u.searchParams.get('offset'));offsets.push(offset);assert.equal(u.searchParams.get('count'),'20');return response({query:{more_results_available:offset===0},web:{results:Array.from({length:20},(_,i)=>{const p=indexedPerson(offset*20+i);return {title:p.title,url:p.link,description:p.snippet};})}});}});assert.ok(offsets.includes(1));assert.ok(offsets.every(n=>n<2));
  assert.deepEqual(duckDuckGoNext('<form><input name="q" value="Company"><input name="s" value="30"><input name="vqd" value="token&amp;x"></form>','Company'),{q:'Company',s:'30',vqd:'token&x'});assert.equal(duckDuckGoNext('<form><input name="s" value="0"></form>','Company'),null);
});
test('100 browser profiles receive pattern confidence with one Google DoH MX check, stay unverified and deduplicate imports',async t=>{
  const store=await personal(t),queue=taskQueue(store);await store.db.prepare('INSERT INTO companies(domain,name,body) VALUES(?,?,?)').run('company.com','Company',JSON.stringify({name:'Company',domain:'company.com',source:'User-confirmed corporate website',learnedPattern:{pattern:'{f}{last}',status:'corroborated',sampleCount:3}}));
  const profiles=Array.from({length:100},(_,i)=>({fullName:testName(i),title:'Senior Analyst',profileUrl:`https://linkedin.com/in/person-${i}?trk=x`})),data={company:'Company',sourceUrl:'https://www.linkedin.com/company/company/people/',profiles};
  const first=await queueBrowserContacts(data,store,queue),again=await queueBrowserContacts(data,store,queue);assert.equal(first.taskId,again.taskId);let dns=0;
  const result=await importBrowserContacts(await queue.get(first.taskId),store,{},async input=>{assert.equal(new URL(input).hostname,'dns.google');dns++;return response({Status:0,Answer:[{type:15,data:'10 mx.company.com.'}]});});assert.equal(result.added,100);assert.equal(dns,1);assert.equal(store.state.contacts.length,100);assert.ok(store.state.contacts.every(c=>c.emailStatus==='unverified' && c.emailInferred && c.domainVerification.hasMx && c.confidence===75));assert.equal(store.state.contacts[0].email,'paa@company.com');assert.equal(store.state.campaigns.length,0);
  assert.equal((await importBrowserContacts(await queue.get(first.taskId),store,{},async()=>response({Status:0,Answer:[{type:15,data:'10 mx.company.com.'}]}))).added,0);
});
test('all depth settings reach durable worker payloads and industry presets contain ten distinct firms',async t=>{
  const store=await personal(t),queue=taskQueue(store);for(const targetCount of [15,35,50,100]){const {run}=await startContactDiscovery({source:'domains',domains:['company.com'],targetCount},store,queue);assert.equal(run.targetCount,targetCount);assert.equal(run.contactsPerCompany,targetCount);for(const target of run.targets){target.status='completed';await queue.cancel(target.taskId);}await store.save();}
  for(const c of Object.values(CONTACT_CLUSTERS)){assert.equal(c.companies.length,10);assert.equal(new Set(c.companies.map(v=>v[1])).size,10);}
});

test('industry clusters process ten firms concurrently while keeping per-firm quotas and never queueing outreach',async t=>{
  const {startBulkHarvest}=await import('../server/services/bulk-harvest.mjs'),store=await personal(t),queue=taskQueue(store),{run}=await startBulkHarvest({source:'companies',preset:'finance',companyLimit:10,contactsPerCompany:10},store,queue);assert.equal(run.targetCount,100);let active=0,peak=0;
  await discoverBulkBatch(await queue.get(run.taskId),store,queue,{},async()=>assert.fail('No external request'),{findCompanyContacts:async(_job,company,options)=>{assert.equal(options.limit,10);active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,10));active--;return {contacts:[{name:'Riley Quinn',title:'Director',email:`riley@${company.domain}`,emailStatus:'unverified'}],warnings:[]};}});assert.equal(peak,10);assert.equal(store.state.contacts.length,10);assert.ok(store.state.contactDiscoveryRuns[0].targets.every(t=>t.status==='completed'));assert.equal(store.state.campaigns.length,0);
});

test('public DuckDuckGo pagination reuses next-form tokens and preserves unique profiles across overlapping tier results',async()=>{
  const requested=[];const found=await searchCompanyPeople('Company','company.com',{targetCount:50,fetcher:async(input,init)=>{assert.equal(new URL(input).hostname,'lite.duckduckgo.com');const p=new URLSearchParams(init.body),q=p.get('q'),page=p.get('s')==='30'?2:1,tier=q.includes('"Managing Director"')?0:q.includes('"Team Lead"')?1:q.includes('"Talent Acquisition"')?2:3;requested.push(page);if(page===2)assert.equal(p.get('vqd'),'public-token');const rows=Array.from({length:10},(_,i)=>indexedPerson(page===1?i:10+tier*10+i)).map(r=>`<a href="${r.link}">${r.title}</a>`).join(''),next=page===1?`<form method="post"><input name="q" value="${q.replaceAll('"','&quot;')}"><input name="s" value="30"><input name="vqd" value="public-token"></form>`:'';return new Response(rows+next);}});assert.equal(found.people.length,50);assert.ok(requested.includes(2));
});
test('MX work is batched at twenty domains and never promotes suggested recipients to verified',async()=>{
  let active=0,peak=0,calls=0;const contacts=Array.from({length:45},(_,i)=>({email:`maya@company${i}.com`,emailStatus:'unverified'}));
  const results=await checkContactDomains(contacts,{fetcher:async()=>{active++;peak=Math.max(peak,active);calls++;await new Promise(r=>setTimeout(r,5));active--;return response({Status:0,Answer:[{type:15,data:'10 mx.company.com.'}]});}});assert.equal(peak,20);assert.equal(calls,45);assert.ok(results.every(c=>c.domainVerification.hasMx && c.emailStatus==='unverified'));
});
test('deep mailbox verification preserves the shared daily quota and does not repeat MX checks per address',async t=>{
  const store=await personal(t),seedContacts=Array.from({length:25},(_,i)=>({name:testName(i),email:`person${i}@company.com`,companyDomain:'company.com',company:'Company',title:'Director',emailStatus:'unverified'}));let verified=0;
  const found=await findCompanyContacts({company:'Company',title:'Financial Analyst'},{domain:'company.com',name:'Company'},{store,seedContacts,seedOnly:true,allowPublic:false,allowCredits:true,targetCount:25,dailyLimit:3,domainHealth:{domain:'company.com',hasMx:true,status:'mx-found'},config:{HUNTER_API_KEY:'test'},fetcher:async input=>{assert.equal(new URL(input).pathname,'/v2/email-verifier');verified++;return response({data:{status:'valid'}});}});assert.equal(verified,3);assert.equal(found.contacts.filter(c=>c.emailStatus==='verified').length,3);assert.equal(found.contacts.length,25);assert.ok(found.retryAt>Date.now());assert.equal(Number((await store.db.prepare('SELECT count(*) AS count FROM provider_requests').get()).count),3);
});

import {extractPatternFromSnippets} from '../server/services/company-patterns.mjs';
import {linkedinLaunch,readLinkedinIntent} from '../server/services/linkedin-launch.mjs';
import {deliveryFailure,recordBounceRecovery,queueBounceRecovery,recoverBounceAlternative} from '../server/services/bounce-recovery.mjs';
test('public email evidence separates stated formats, ambiguous masks and observed addresses from mailbox verification',()=>{
  const evidence=extractPatternFromSnippets([{title:'Email format',snippet:'The email format is first.last@company.com; Maya Singh email m***.s****@company.com. Public: asha.verma@company.com',link:'https://company.com/team'}],'company.com',[{name:'Maya Singh'}]);assert.equal(evidence.pattern,'{first}.{last}');assert.equal(evidence.mailboxVerified,false);assert.deepEqual(evidence.masked[0].candidates,['{first}.{last}']);assert.ok(evidence.observedEmails.some(e=>e.email==='asha.verma@company.com'));
  const ambiguous=extractPatternFromSnippets(['John Smith email is j***@company.com'],'company.com');assert.equal(ambiguous.pattern,null);assert.ok(ambiguous.candidates.length>1);assert.equal(ambiguous.mailboxVerified,false);
});
test('only explicit mailbox verification promotes an invalid primary to a verified alternate; login account endpoints are never queried',async t=>{
  const store=await personal(t),seen=[],result=await findCompanyContacts({company:'Company',title:'Analyst'},{domain:'company.com',name:'Company'},{store,seedOnly:true,seedContacts:[{name:'Maya Singh',company:'Company',title:'Director',email:'maya.singh@company.com',alternateEmails:['msingh@company.com'],emailStatus:'unverified'}],targetCount:1,tryAlternates:true,allowCredits:true,allowPublic:false,dailyLimit:10,domainHealth:{hasMx:true,status:'mx-found'},config:{HUNTER_API_KEY:'test'},fetcher:async input=>{const u=new URL(input);assert.equal(u.hostname,'api.hunter.io');seen.push(u.searchParams.get('email'));return response({data:{status:u.searchParams.get('email')==='msingh@company.com'?'valid':'invalid'}});}});assert.deepEqual(seen,['maya.singh@company.com','msingh@company.com']);assert.equal(result.contacts[0].email,'msingh@company.com');assert.equal(result.contacts[0].emailStatus,'verified');assert.equal((await companyPattern(store,'company.com')).learnedPattern.mailboxVerified,false);
});
test('hard-bounce recovery matches an accepted recipient, cancels follow-ups and requires a verified alternative and fresh send approval',async t=>{
  const store=await personal(t),queue=taskQueue(store),contact={id:'bounce-contact',name:'Maya Singh',company:'Company',companyDomain:'company.com',email:'maya.singh@company.com',emailStatus:'verified',alternateEmails:['msingh@company.com'],suppressed:false,isDemo:false},followup=await queue.enqueue('campaign.followup',{campaignId:'bounce-campaign'});await store.db.prepare('INSERT INTO companies(domain,name,body) VALUES(?,?,?)').run('company.com','Company','{}');store.state.contacts.push(contact);store.state.campaigns.push({id:'bounce-campaign',name:'Pitch',deliveries:[{contactId:contact.id,taskId:'original',status:'accepted',internetMessageId:'<original@candidate.com>',followupTaskId:followup.id}]});await store.save();await store.db.prepare("INSERT INTO outreach_send_log(user_id,contact_email,campaign_id,sequence_step,task_id,status,updated_at) VALUES('local',?,?,0,?,'accepted',?)").run(contact.email,'bounce-campaign','original',Date.now());
  const message={id:'bounce-mail',from:'Mail Delivery <mailer-daemon@company.com>',subject:'Undeliverable: Pitch',body:'Final-Recipient: rfc822; maya.singh@company.com\nStatus: 5.1.1\nOriginal-Message-ID: <original@candidate.com>',receivedAt:new Date().toISOString()};assert.ok(deliveryFailure(message));assert.equal(deliveryFailure({...message,body:message.body.replace('5.1.1','5.7.1')}),null);assert.equal((await recordBounceRecovery(message,store)).handled,true);assert.equal((await queue.get(followup.id)).status,'cancelled');assert.equal(store.state.contacts[0].email,'maya.singh@company.com');assert.equal(store.state.contacts[0].emailStatus,'invalid');assert.equal((await recordBounceRecovery(message,store)).duplicate,true);
  const queued=await queueBounceRecovery({contactId:contact.id,email:'msingh@company.com',confirmed:true,allowCredits:true},store,queue);await recoverBounceAlternative(await queue.get(queued.taskId),store,{HUNTER_API_KEY:'test'},async()=>response({data:{status:'valid'}}),mx);assert.equal(store.state.contacts[0].email,'msingh@company.com');assert.equal(store.state.contacts[0].emailStatus,'verified');assert.equal(store.state.contacts[0].bounceRecovery.requiresApproval,true);assert.equal((await queue.list()).filter(t=>t.kind==='campaign.send').length,0);
});
test('automatic LinkedIn launches are short-lived, company-bound intents instead of accepting arbitrary public URL fragments',()=>{
  const config={TOKEN_ENCRYPTION_KEY:'test-only-key'},launch=linkedinLaunch({company:'Deloitte',domain:'deloitte.com',role:'Financial Analyst',targetCount:50},config),u=new URL(launch.url),params=new URLSearchParams(u.hash.slice(1)),intent=params.get('veloce_intent'),decoded=readLinkedinIntent(intent,u.href,config);assert.equal(decoded.company,'Deloitte');assert.equal(decoded.count,50);assert.throws(()=>readLinkedinIntent(intent,u.href.replace('Deloitte','Other'),config),/different search/);assert.throws(()=>readLinkedinIntent(intent+'x',u.href,config),/invalid|fresh/);
});

test('public email dork results can supply a source-linked personal address while still requiring mailbox verification',async t=>{
  const store=await personal(t),queue=taskQueue(store),queued=await queueBrowserContacts({company:'Company',domain:'company.com',domainConfirmed:true,allowSearch:true,sourceUrl:'https://www.linkedin.com/in/maya-singh',profiles:[{name:'Maya Singh',title:'Director',profileUrl:'https://www.linkedin.com/in/maya-singh'}]},store,queue),result=await importBrowserContacts(await queue.get(queued.taskId),store,{TAVILY_API_KEY:'test'},async input=>{if(new URL(input).hostname==='api.tavily.com')return response({results:[{title:'Maya Singh contact details',url:'https://company.com/team/maya',content:'Maya Singh email: msingh@company.com'}]});return response({Status:0,Answer:[{type:15,data:'10 mx.company.com.'}]});},{lookupMx:mx});assert.equal(result.added,1);const c=store.state.contacts[0];assert.equal(c.email,'msingh@company.com');assert.equal(c.emailStatus,'unverified');assert.equal(c.verification.reference,'https://company.com/team/maya');assert.ok(c.alternateEmails.includes('maya.singh@company.com'));
});
