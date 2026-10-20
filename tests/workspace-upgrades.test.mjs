import {findHunterEmail} from '../server/providers/contacts/hunter.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {extractText} from 'unpdf';
import {openStore} from '../server/store.mjs';
import {initialState} from '../server/fixtures.mjs';
import {createApp} from '../server/index.mjs';
import {taskQueue} from '../server/queue.mjs';
import {handlers,runOne} from '../server/worker.mjs';
import {hash,campaignFingerprint,previewCampaign} from '../server/domain.mjs';
import {regionalResults,fetchRegional} from '../server/providers/jobs/regional.mjs';
import {sourcePlan} from '../server/services/discovery.mjs';
import {buildSearchPlan} from '../server/services/search-plan.mjs';
import {sharedBackground,warmPeople,warmHook,prioritizeWarmContacts} from '../server/services/warm-connections.mjs';
import {findCompanyContacts} from '../server/services/contact-discovery.mjs';
import {buildJobDocuments,documentFingerprint,documentEvidence,ensureJobDocuments,renderTextPDF,selectDocumentEvidence} from '../server/services/job-documents.mjs';
import {normalizeSequence,DEFAULT_FOLLOWUPS} from '../server/services/sequences.mjs';
import {queueCampaign} from '../server/services/outreach.mjs';
import {tokenCipher} from '../server/providers/mail/oauth.mjs';
import {ingestMessage} from '../server/services/inbox.mjs';
import {inboxActions} from '../server/services/inbox-actions.mjs';
import {saveAlerts,alertStatus,queueAlert,deliverAlert} from '../server/services/notifications.mjs';
import {ensureCampaignLinks,serveResumeLink} from '../server/services/engagement.mjs';

const response=value=>new Response(JSON.stringify(value)),config={TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),ENABLE_LIVE_SEND:'true',ENABLE_JOB_DISCOVERY:'false',PUBLIC_BASE_URL:'https://orbit.test'};
async function workspace(t) {
  const store=openStore(':memory:');t.after(()=>store.close());const state=initialState(false);
  state.profile={...state.profile,name:'Casey Quinn',email:'casey@candidate.com',skills:['Excel','Valuation'],interests:['Financial Analyst'],location:'Mumbai or Bengaluru or Delhi',workMode:'Any',master:{personal:{fullName:'Casey Quinn',email:'casey@candidate.com'},summary:{headline:'Financial Analyst'},education:[{institution:'Example University',degree:'B.Com',fieldOfStudy:'Finance'}],workExperience:[{company:'Previous Advisory',title:'Finance Intern',startYear:'2025',endYear:'2025',bullets:['Prepared cash flow models using Excel.','Reconciled financial statements and investigated variances.']}],skills:{technical:['Excel'],financeAndTools:['Valuation']}}};
  state.resume={name:'original.txt',text:'Casey Quinn\n- Prepared cash flow models using Excel.',base64:Buffer.from('Original resume bytes').toString('base64')};
  state.jobs=[{id:'job',company:'Example Bank',companyDomain:'company.com',title:'Financial Analyst Intern',location:'Mumbai, India',workMode:'On-site',url:'https://boards.greenhouse.io/company/jobs/1',tags:['Excel','DCF'],description:'Build cash flow models in Excel. Analyze financial statements and valuation assumptions.',isDemo:false}];
  state.contacts=[{id:'contact',name:'Riley Test',title:'Recruiter',company:'Example Bank',jobId:'job',email:'riley@company.com',emailStatus:'verified',suppressed:false,isDemo:false}];
  state.career={weeklyGoal:10,tasks:[],prep:[],stories:[{id:'story',title:'Cash flow model',situation:'A forecast was needed.',task:'Prepare the analysis.',action:'I built a cash flow model using Excel.',result:'The finance team reviewed the assumptions.',archived:false}]};
  await store.replace(state);await store.db.prepare('INSERT INTO companies(domain,name,body) VALUES(?,?,?)').run('company.com','Example Bank','{}');store.state.contacts[0].companyDomain='company.com';await store.save();return store;
}
function fakeRes(){return {writeHead(status,headers){this.status=status;this.headers=headers;},end(value){this.bytes=value;}};}
test('regional discovery uses actual indexed job URLs for all six boards and never scrapes a portal or invents company facts',async()=>{
  const rows=[
    {link:'https://www.naukri.com/job-listings-analyst-bank-123',title:'Financial Analyst - Example Bank - Mumbai - 0 to 2 years',snippet:'Finance internship in Mumbai.'},
    {link:'https://www.instahyre.com/job-123-analyst/',title:'Financial Analyst job at Example Bank | Instahyre',snippet:'Bengaluru finance team.'},
    {link:'https://www.efinancialcareers.com/jobs-India-Mumbai-Finance.id123',title:'Financial Analyst | eFinancialCareers',snippet:'Mumbai India.'},
    {link:'https://www.iimjobs.com/j/example-bank-analyst-123',title:'Example Bank - Investment Banking Analyst - Mumbai',snippet:'Finance internship.'},
    {link:'https://internshala.com/internship/detail/financial-analyst-internship-123',title:'Financial Analyst internship at Example Bank | Internshala',snippet:'Delhi.'},
    {link:'https://wellfound.com/jobs/123-finance',title:'Financial Analyst at Example Bank • Bengaluru | Wellfound',snippet:'Bengaluru startup.'},
    {link:'https://wellfound.com/jobs',title:'Category, not a job'},
    {link:'https://wellfound.com.evil.test/jobs/123',title:'Spoof'},
  ];
  const jobs=regionalResults(rows,'Financial Analyst');assert.equal(jobs.length,6);assert.equal(new Set(jobs.map(j=>j.source)).size,6);assert.ok(jobs.every(j=>j.indexedSnippet && j.publishedAt===null));assert.equal(jobs[2].company,'Company not listed');assert.equal(jobs[2].requiresSourceReview,true);
  let calls=0;const result=await fetchRegional('Financial Analyst',{SERPAPI_API_KEY:'mock',SEARCH_LOCATION:'Mumbai'},async url=>{calls++;const u=new URL(url);assert.equal(u.hostname,'serpapi.com');assert.match(u.searchParams.get('q'),/site:naukri.com/);return response({organic_results:rows});});assert.equal(calls,1);assert.equal(result.length,6);
  await assert.rejects(fetchRegional('Finance',{}),/SERPAPI_API_KEY/);
  const plan=buildSearchPlan({profile:{interests:['Financial Analyst'],location:'Mumbai or Delhi',skills:[]}},{roles:['Financial Analyst'],country:'IN',location:'Mumbai or Delhi',workMode:'Any',experience:'Internship'});
  assert.equal(sourcePlan(plan,{}, {sources:{'India & finance boards':true}}).length,2);
});
test('warm hooks require explicit shared-background evidence; co-occurring keywords and removed school details do not become claims',async t=>{
  const store=await workspace(t),background=sharedBackground(store.state),rows=[{title:'Riley Test - Recruiter at Example Bank | LinkedIn',link:'https://www.linkedin.com/in/riley-test/',snippet:'Recruiter at Example Bank. Education: Example University.'},{title:'Taylor Lee - Manager at Example Bank | LinkedIn',link:'https://www.linkedin.com/in/taylor-lee/',snippet:'Example University events. Example Bank news.'}];
  const people=warmPeople(rows,'Example Bank',background);assert.equal(people[0].warmSignals[0].status,'source-supported');assert.equal(people[1].warmSignals[0].status,'possible');
  assert.match(warmHook({...people[0],company:'Example Bank'},store.state),/also studied at Example University/);assert.equal(warmHook({...people[1],company:'Example Bank'},store.state),'');
  const fetcher=async()=>response({organic_results:rows}),cfg={SERPAPI_API_KEY:'mock',JOB_SEARCH_API_DAILY_LIMIT:6};
  const ranked=await prioritizeWarmContacts(store.state.contacts,store.state.jobs[0],store,cfg,fetcher,true);assert.equal(ranked.contacts[0].warmSignals[0].name,'Example University');
  await prioritizeWarmContacts(store.state.contacts,store.state.jobs[0],store,cfg,()=>assert.fail('Cached search repeated'),true);
  store.state.profile.master.education=[];assert.equal(warmHook({...people[0],company:'Example Bank'},store.state),'');
});
test('warm prospects can be saved without guessed addresses; a work-email finder must return the exact corporate domain',async t=>{
  const store=await workspace(t);store.state.contacts=[];await store.save();
  const fetcher=async url=>{const u=new URL(url);if(u.hostname==='serpapi.com')return response({organic_results:[{title:'Riley Test - Recruiter at Example Bank',link:'https://www.linkedin.com/in/riley-test/',snippet:'Education: Example University.'}]});assert.equal(u.pathname,'/v2/email-finder');return response({data:{email:'wrong@other-company.com',verification:{status:'valid'}}});};
  const found=await findCompanyContacts(store.state.jobs[0],{domain:'company.com'},{store,config:{SERPAPI_API_KEY:'mock'},fetcher,pages:async()=>[],allowWarmSearch:true,limit:3});assert.equal(found.contacts.length,1);assert.equal(found.contacts[0].email,'');assert.equal(found.contacts[0].emailStatus,'unverified');
  const catchAll=await findHunterEmail({name:'Riley Test'},'company.com','mock',async()=>response({data:{email:'riley@company.com',accept_all:true,verification:{status:'valid'}}}));assert.equal(catchAll.emailStatus,'catch-all');
});
test('per-job documents contain source text, real history and education, deduplicate evidence, cache and cancel stale work',async t=>{
  const store=await workspace(t),queue=taskQueue(store),job=store.state.jobs[0],fingerprint=documentFingerprint(store.state,job);
  const task=await queue.enqueue('documents.build',{jobId:job.id,fingerprint});assert.equal((await runOne(store,queue,handlers(store,queue,{}),task.id)).status,'completed');await store.refresh();
  const document=store.state.jobDocuments[0];assert.match(document.resume.base64,/^JVBER/);assert.ok(document.coverLetter.size>1000);
  const extracted=await extractText(new Uint8Array(Buffer.from(document.resume.base64,'base64')),{mergePages:true});assert.match(extracted.text,/Previous Advisory/);assert.match(extracted.text,/Example University/);assert.match(extracted.text,/Prepared cash flow models using Excel/);assert.ok(!extracted.text.includes('10 years'));
  const unique=documentEvidence(store.state);assert.equal(unique.filter(e=>e.text==='Prepared cash flow models using Excel.').length,1);
  assert.ok(document.wordCount>=200 && document.wordCount<350,`Cover length ${document.wordCount}`);
  assert.equal((await ensureJobDocuments(job,store,queue)).id,document.id);
  store.state.profile.master.summary.headline='Updated headline';await store.save();assert.equal((await buildJobDocuments({payload:{jobId:job.id,fingerprint}},store,queue)).status,'cancelled');
});
async function campaign(t) {
  const store=await workspace(t),queue=taskQueue(store),messages=[];
  await store.db.prepare('INSERT INTO mail_accounts(id,provider,email,secret,metadata) VALUES(?,?,?,?,?)').run('mail','google',store.state.profile.email,tokenCipher(config).seal({access_token:'mock',refresh_token:'mock',expires_at:Date.now()+30*86400000}),JSON.stringify({lastSync:new Date().toISOString()}));
  const c={id:'campaign',name:'Job pitch',subject:'Financial analyst role',body:'A factual introduction.',contactIds:['contact'],accountId:'mail',attachResume:false,sequence:normalizeSequence({enabled:true,steps:DEFAULT_FOLLOWUPS},'mail'),deliveries:[]};store.state.campaigns=[c];
  const previewId='preview';store.state.previews[previewId]={campaignId:c.id,fingerprint:campaignFingerprint(c,store.state),expires:Date.now()+600000};await store.save();
  const queued=await queueCampaign(c,{previewId,approved:true,confirmCount:1},store,queue,config);
  const fetcher=async(url,options={})=>{if(String(url).endsWith('/messages/send')){const data=JSON.parse(options.body),raw=Buffer.from(data.raw,'base64url').toString();messages.push({raw,threadId:data.threadId});return response({id:`provider-${messages.length}`,threadId:'thread'});}if(String(url).includes('/profile'))return response({historyId:'123'});return response({messages:[],historyId:'123'});};
  const registry=handlers(store,queue,config,fetcher);assert.equal((await runOne(store,queue,registry,queued.deliveries[0].taskId)).status,'completed');await store.refresh();return {store,queue,registry,messages};
}
test('day 4 and day 8 business-day steps send once in the original thread with correct RFC references',async t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-19T09:00:00Z')});const {store,queue,registry,messages}=await campaign(t),delivery=store.state.campaigns[0].deliveries[0];
  assert.equal(delivery.followups.length,2);const initialId=delivery.internetMessageId;
  assert.match(delivery.followups[0].scheduledAt,/2026-10-23/);assert.match(delivery.followups[1].scheduledAt,/2026-10-29/);
  for(const step of delivery.followups){t.mock.timers.setTime(Date.parse(step.scheduledAt));assert.equal((await runOne(store,queue,registry,step.taskId)).status,'completed');}
  await store.refresh();assert.equal(messages.length,3);assert.equal(messages[1].threadId,'thread');assert.match(messages[1].raw,new RegExp(`In-Reply-To: ${initialId.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`));
  const steps=store.state.campaigns[0].deliveries[0].followups;assert.ok(messages[2].raw.includes(`In-Reply-To: ${steps[0].internetMessageId}`));assert.ok(messages[2].raw.includes(`References: ${initialId} ${steps[0].internetMessageId}`));assert.equal(await runOne(store,queue,registry,steps[1].taskId),null);
  assert.deepEqual((await store.db.prepare('SELECT sequence_step,status FROM outreach_send_log ORDER BY sequence_step').all()).map(r=>r.status),['accepted','accepted','accepted']);
  assert.throws(()=>normalizeSequence({enabled:true,steps:[{afterBusinessDays:4,body:'A'},{afterBusinessDays:4,body:'B'}]},'mail'),/ascending/);
});
test('a contact reply in any thread cancels every queued company follow-up and its send reservation',async t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-19T09:00:00Z')});const {store,queue,messages}=await campaign(t);
  await ingestMessage({id:'reply',from:'Riley <riley@company.com>',subject:'Reaching out',body:'Happy to discuss the role.',receivedAt:new Date().toISOString()},store);
  for(const step of store.state.campaigns[0].deliveries[0].followups){assert.equal((await queue.get(step.taskId)).status,'cancelled');assert.equal(step.status,'cancelled');}
  assert.equal((await store.db.prepare("SELECT count(*) AS n FROM outreach_send_log WHERE sequence_step>0 AND status='queued'").get()).n,0);assert.equal(messages.length,1);
});
test('tracked résumé requests are per recipient, scanner-aware, deduplicated, revocable and do not invalidate campaign approval',async t=>{
  const store=await workspace(t),queue=taskQueue(store),c={id:'c',name:'C',subject:'Hello',body:'Resume: {{resume_url}}',trackResume:true,contactIds:['contact'],deliveries:[]};store.state.campaigns=[c];
  await ensureCampaignLinks(c,store,config);const link=c.resumeLinks.contact,token=new URL(link.url).pathname.split('/').at(-1),fingerprint=campaignFingerprint(c,store.state);
  assert.ok(link.expires>Date.now()+20*86400000);assert.ok(previewCampaign(c,store.state).messages[0].body.includes(link.url));
  await serveResumeLink({headers:{'user-agent':'SafeLinks Scanner'}},fakeRes(),token,store,queue,config);assert.equal(store.state.contacts[0].resumeActivityAt,undefined);
  await serveResumeLink({headers:{'user-agent':'Mozilla/5.0'}},fakeRes(),token,store,queue,config);assert.ok(store.state.contacts[0].resumeActivityAt);assert.equal(campaignFingerprint(c,store.state),fingerprint);
  await serveResumeLink({headers:{'user-agent':'Mozilla/5.0'}},fakeRes(),token,store,queue,config);assert.equal(store.state.contacts[0].resumeActivityCount,1);
  await store.db.prepare('UPDATE public_resumes SET revoked=1 WHERE id=?').run(link.id);await assert.rejects(serveResumeLink({headers:{}},fakeRes(),token,store,queue,config),/expired/);
});
test('alert destinations are constrained, credentials encrypted, changes cancel queued sends and unknown acceptance is never retried',async t=>{
  const store=await workspace(t),queue=taskQueue(store),secret='123456789:abcdefghijklmnopqrstuvwx';
  await assert.rejects(saveAlerts({provider:'discord',enabled:true,confirmed:true,credentials:{webhookUrl:'http://127.0.0.1/private'}},store,config),/Discord/);
  await saveAlerts({provider:'telegram',enabled:true,confirmed:true,credentials:{botToken:secret,chatId:'123456789'},events:['interview','resume-view']},store,config);
  assert.ok(!JSON.stringify(alertStatus(store)).includes(secret));assert.ok(!JSON.stringify(store.state.alertConfig).includes(secret));
  const task=await queueAlert('interview','Interview invitation: Example Bank','message-1',store,queue);assert.equal((await queueAlert('interview','Same','message-1',store,queue)).id,task.id);
  assert.equal(await queueAlert('assessment','Not selected','other',store,queue),null);
  await queue.enqueue('jobs.sync',{source:'Remotive'},{runAt:Date.now()-1000});
  assert.equal((await queue.claim()).id,task.id,'Due phone alerts should not wait behind discovery work');
  const result=await deliverAlert(task,store,config,async(url,options)=>{assert.match(String(url),/^https:\/\/api.telegram.org\/bot/);assert.equal(JSON.parse(options.body).chat_id,'123456789');throw Error('Ambiguous timeout');});assert.equal(result.status,'unknown');
  await saveAlerts({provider:'telegram',enabled:false},store,config);assert.equal((await deliverAlert(task,store,config,()=>assert.fail('Disabled alert sent'))).status,'cancelled');
});
test('unique interview emails queue one company kit and planner action with real STAR suggestions; ambiguity and stale mail do not',async t=>{
  const store=await workspace(t),queue=taskQueue(store),at=new Date().toISOString();store.state.applications=[{id:'application',jobId:'job',stage:'Applied',history:[],createdAt:at}];store.state.settings.inboxAutoUpdate=true;await store.save();
  const message={id:'invite',from:'hr@company.com',subject:'Interview: Financial Analyst Intern at Example Bank',body:'Please schedule your interview for the Financial Analyst Intern role at Example Bank.',receivedAt:at};
  const result=await ingestMessage(message,store);await inboxActions(result.item,store,queue,{});await inboxActions(result.item,store,queue,{});
  const tasks=(await queue.list()).filter(t=>t.kind==='career.prep');assert.equal(tasks.length,1);assert.equal(store.state.career.tasks.length,1);assert.equal(store.state.career.tasks[0].dueAt,null);
  assert.equal((await runOne(store,queue,handlers(store,queue,{}),tasks[0].id)).status,'completed');await store.refresh();const guide=store.state.career.prep[0];assert.equal(guide.trigger,'inbox');assert.ok(guide.questions.some(q=>q.storyIds.includes('story')));assert.ok(guide.questions.every(q=>q.answerNotes===''));
  const previous=store.state.career.tasks.length;await inboxActions({...result.item,messageId:'ambiguous',actionsQueued:null,ambiguous:true},store,queue,{});assert.equal(store.state.career.tasks.length,previous);
});
test('private document/alert APIs and extension leases restrict files to the exact queued job; bootstrap excludes secret bodies',async t=>{
  const store=await workspace(t),queue=taskQueue(store);const app=createApp({store,config:{...config,WORKSPACE_PASSWORD:'test-password'},fetcher:()=>assert.fail('Unexpected provider call')});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(async()=>{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));});const base=`http://127.0.0.1:${app.server.address().port}`,headers={Authorization:`Basic ${Buffer.from('orbit:test-password').toString('base64')}`};
  async function call(path,data,method=data ? 'POST' : 'GET',auth=headers){const r=await fetch(`${base}${path}`,{method,headers:{...auth,...(data ? {'Content-Type':'application/json'} : {})},...(data ? {body:JSON.stringify(data)} : {})});const raw=await r.text();return {status:r.status,raw,json:r.headers.get('content-type')?.includes('application/json') ? JSON.parse(raw) : null};}
  assert.equal((await call('/api/documents',null,'GET',{})).status,401);assert.equal((await call('/api/alerts',null,'GET',{})).status,401);
  const queued=await call('/api/apply/queue',{jobIds:['job'],approved:true});assert.equal(queued.status,202);assert.equal(queued.json.taskIds.length,1);
  const token=(await call('/api/extension/token',{})).json.token,bearer={Authorization:`Bearer ${token}`};
  const task=(await call('/api/extension/next',{taskIds:queued.json.taskIds},'POST',bearer)).json.task;assert.ok(task.id);
  assert.equal((await call('/api/extension/documents',{taskId:task.id,url:'https://other.greenhouse.io/job'},'POST',bearer)).status,409);
  const documents=await call('/api/extension/documents',{taskId:task.id,url:task.url},'POST',bearer);assert.equal(documents.status,200);assert.match(documents.json.coverLetter.base64,/^JVBER/);
  const copilot=await call('/api/extension/copilot',{taskId:task.id,url:task.url},'POST',bearer);assert.equal(copilot.json.matched,true);assert.ok(copilot.json.missingKeywords.includes('DCF')===false);assert.ok(!copilot.raw.includes('riley@company.com'));
  const report=await call('/api/extension/report',{taskId:task.id,status:'needs-review',pageUrl:task.url,formOrigins:['https://job-boards.greenhouse.io'],missing:[]},'POST',bearer);assert.equal(report.status,200);
  const submitted={taskId:task.id,status:'submission-pending',url:'https://job-boards.greenhouse.io/company/jobs/1',topUrl:task.url};
  assert.equal((await call('/api/extension/submission',submitted,'POST',bearer)).status,200);
  assert.equal((await call('/api/extension/submission',{...submitted,status:'confirmed',evidence:'Application submitted'},'POST',bearer)).status,200);
  const alerts=await call('/api/alerts',{provider:'telegram',enabled:false,credentials:{botToken:'123456789:abcdefghijklmnopqrstuvwx',chatId:'123456789'}},'PUT');assert.equal(alerts.status,200);
  await store.refresh();
  const bootstrap=await call('/api/bootstrap');assert.ok(!bootstrap.raw.includes('jobDocuments'));assert.ok(!bootstrap.raw.includes('alertConfig'));assert.ok(!bootstrap.raw.includes('abcdefghijklmnopqrstuvwx'));assert.ok(!bootstrap.raw.includes(store.state.alertConfig.credentials));assert.ok(!bootstrap.raw.includes('JVBER'));
  assert.equal((await call(`/api/documents/${documents.json.documentId}/resume`,null,'GET',{})).status,401);assert.match((await call(`/api/documents/${documents.json.documentId}/resume`)).raw,/^%PDF-/);
  assert.equal((await call('/api/extension/next',{taskIds:Array(11).fill(task.id)},'POST',bearer)).status,400);
});

test('PDF fonts retain rupee symbols and Indian names; unsupported glyphs fail instead of silently disappearing',async()=>{
  const bytes=await renderTextPDF({title:'Casey | केशवी',sections:[{heading:'Finance',lines:['Prepared a ₹25,000 model. Café and β sensitivity.']}]});
  const extracted=await extractText(new Uint8Array(bytes),{mergePages:true});assert.match(extracted.text,/₹25,000/);assert.match(extracted.text,/केशवी/);assert.match(extracted.text,/Café/);
  await assert.rejects(renderTextPDF({title:'Unsupported 李',sections:[]}),/cannot render/);
});
test('AI document tailoring can select only existing evidence IDs and never inject a fabricated bullet',async t=>{
  const store=await workspace(t),job=store.state.jobs[0];
  const result=await selectDocumentEvidence(store.state,job,true,{LLM_PROVIDER:'gemini',LLM_MODEL:'mock-model',LLM_API_KEY:'mock'},async()=>response({candidates:[{content:{parts:[{text:JSON.stringify({evidenceIds:['e0','invented-achievement']})}]}}]}),store);
  assert.equal(result.length,1);assert.equal(result[0].text,'Prepared cash flow models using Excel.');
});
