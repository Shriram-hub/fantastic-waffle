import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {openStore} from '../server/store.mjs';
import {initialState} from '../server/fixtures.mjs';
import {createApp} from '../server/index.mjs';
import {taskQueue} from '../server/queue.mjs';
import {handlers,runOne} from '../server/worker.mjs';
import {cleanCompanyName,resolveCompany} from '../server/providers/contacts/company.mjs';
import {domainMailHealth} from '../server/providers/contacts/dns.mjs';
import {verifyWorkEmail} from '../server/providers/contacts/verification.mjs';
import {findCompanyContacts} from '../server/services/contact-discovery.mjs';
import {searchHTMLResults} from '../server/providers/contacts/free-xray.mjs';
import {permuteEmails} from '../server/providers/contacts/permutator.mjs';
import {searchHunterDomain} from '../server/providers/contacts/hunter.mjs';
import {extensionPackage} from '../server/services/extension-package.mjs';
import {packagePairing,redeemPackage} from '../server/services/extension-pairing.mjs';
import {extractLinkedInCompanyPeople} from '../extension/linkedin.mjs';
import {queueBrowserContacts,importBrowserContacts} from '../server/services/browser-contacts.mjs';
import {embeddedWorkerEnabled,requestQueueDrain} from '../server/services/worker-control.mjs';
import {tokenCipher,startOAuth,completeOAuth} from '../server/providers/mail/oauth.mjs';
import {renderTextPDF} from '../server/services/job-documents.mjs';
import {parseResumeAsync} from '../server/resume.mjs';
import {persistResume,hydrateResume} from '../server/services/resume-storage.mjs';
import {mailFailure} from '../server/providers/mail/http.mjs';

const response=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}}),mx=async()=>[{exchange:'aspmx.l.google.com'}],key=Buffer.alloc(32,7).toString('base64');
function workspace(t){const store=openStore(':memory:');t.after(()=>store.close());const s=initialState(false);Object.assign(s.profile,{name:'Casey Quinn',email:'casey@candidate.com',skills:['Excel','SQL'],interests:['Financial Analyst']});s.resume={name:'original.txt',text:'Casey Quinn\nExperience\n- Built Excel forecasts and SQL reports.\nEducation\nBCom Example University',base64:Buffer.from('Original private résumé bytes').toString('base64')};s.jobs=[{id:'job',company:'Deloitte India (Offices of the US)',title:'Financial Analyst',description:'Build Excel financial forecasts and SQL reports.',url:'https://jobs.deloitte.com/job/123',location:'Mumbai',workMode:'On-site',tags:['Excel'],source:'Company',isDemo:false,archived:false}];store.replace(s);return store;}
async function apiWorkspace(t,store,extra={}){const config={WORKSPACE_PASSWORD:'owner-test',TOKEN_ENCRYPTION_KEY:key,ENABLE_JOB_DISCOVERY:'false',...extra},app=createApp({store,config,fetcher:async()=>new Response('blocked',{status:403})});await app.ready;await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{app.events.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));});const base=`http://127.0.0.1:${app.server.address().port}`,headers={Authorization:'Basic '+Buffer.from('orbit:owner-test').toString('base64'),'Content-Type':'application/json'};return {...app,config,base,headers,call:(path,data)=>fetch(base+path,{method:data===undefined ? 'GET' : 'POST',headers,...(data===undefined ? {} : {body:JSON.stringify(data)})})};}
function zipEntries(zip){const entries={};let pos=0;while(zip.readUInt32LE(pos)===0x04034b50){const size=zip.readUInt32LE(pos+18),length=zip.readUInt16LE(pos+26),extra=zip.readUInt16LE(pos+28),start=pos+30+length+extra;entries[zip.subarray(pos+30,pos+30+length).toString()]=zip.subarray(start,start+size);pos=start+size;}return entries;}

test('noisy company names resolve to evidenced domains; live guessed domains remain review-only and ATS hosts are never employers',async t=>{
  const store=workspace(t),offline=async()=>{throw Error('No network');};
  assert.equal(cleanCompanyName('HDFC Bank Pvt. Ltd. - Mumbai'),'HDFC Bank');
  for(const [company,domain] of [['Deloitte India (Offices of the US)','deloitte.com'],['HDFC Bank Pvt Ltd - Mumbai','hdfcbank.com'],['JPMorgan Chase & Co.','jpmorganchase.com'],['EY-Parthenon','ey.com']])assert.equal((await resolveCompany({company},offline,store)).domain,domain);
  await store.db.prepare('INSERT INTO companies(domain,name,body) VALUES(?,?,?)').run('corporate.test','Newco',JSON.stringify({domain:'corporate.test',name:'Newco',source:'User-confirmed corporate website'}));
  assert.equal((await resolveCompany({company:'Newco'},offline,store)).domain,'corporate.test');
  const guessed=await resolveCompany({company:'Unlisted Widgets',applyUrl:'https://www.naukri.com/job-listings-1'},async url=>String(url).includes('dns.google') ? response({Status:0,Answer:[{type:15,data:'10 mx.widgets.test.'}]}) : response([]));
  assert.equal(guessed.requiresDomainReview,true);assert.equal(guessed.domain,'unlistedwidgets.com');
});
test('HTTPS MX fallback survives native DNS/SMTP unavailability and never promotes mailbox guesses to verified',async t=>{
  const store=workspace(t),timeout=async()=>{throw Object.assign(Error('Port/DNS timeout'),{code:'ETIMEOUT'});};
  const fetcher=async url=>String(url).includes('dns.google') ? response({Status:0,Answer:[{type:15,data:'1 aspmx.l.google.com.'}]}) : new Response('blocked',{status:403});
  const health=await domainMailHealth('deloitte.com',{lookupMx:timeout,fetcher});assert.equal(health.hasMx,true);assert.equal(health.gateway,'Google Workspace');
  const found=await findCompanyContacts(store.state.jobs[0],{domain:'deloitte.com'},{store,config:{},fetcher,lookupMx:timeout,pages:async()=>[],limit:3});
  assert.equal(found.contacts.length,3);assert.ok(found.contacts.every(c=>c.email.endsWith('@deloitte.com') && c.domainVerification.hasMx && c.emailStatus==='unverified'));assert.ok(found.contacts.every(c=>c.confidence!==80));
  assert.equal((await verifyWorkEmail(found.contacts[0].email,{},fetcher,timeout)).emailStatus,'unverified');
});
test('public search parses profile evidence and Hunter patterns survive an empty domain search',async()=>{
  const html='<a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.linkedin.com%2Fin%2Friley">Riley Quinn - Recruiter at Company | LinkedIn</a>';
  assert.equal(searchHTMLResults(html,'DuckDuckGo')[0].link,'https://www.linkedin.com/in/riley');assert.deepEqual(searchHTMLResults('CAPTCHA '+html,'DuckDuckGo'),[]);
  const found=await searchHunterDomain('company.com','test',3,async()=>response({data:{domain:'company.com',pattern:'{f}{last}',emails:[]}}));assert.equal(found.pattern,'{f}{last}');
  const [candidate]=permuteEmails({firstName:'Riley',lastName:'Quinn',companyDomain:'company.com',domainPattern:found.pattern});assert.equal(candidate.email,'rquinn@company.com');assert.equal(candidate.emailStatus,'unverified');
});
test('job auto-pitch API queues the complete contact, PDF and personalized draft chain, retaining verification and send gates',async t=>{
  const store=workspace(t),w=await apiWorkspace(t,store),queue=taskQueue(store);
  const r=await w.call('/api/jobs/job/auto-pitch',{});assert.equal(r.status,202);const start=await r.json();
  const done=await runOne(store,queue,handlers(store,queue,{},async()=>new Response('blocked',{status:403}),{lookupMx:mx,contactPages:async()=>[{url:'https://deloitte.com/careers',text:'Apply at jobs@deloitte.com'}]}),start.pitch.taskId);
  assert.equal(done.status,'completed');await store.refresh();const result=await (await w.call('/api/jobs/job/auto-pitch')).json();
  assert.ok(result.pitch.documents.resume.size>1000);assert.ok(result.pitch.documents.coverLetter.size>1000);assert.equal(result.pitch.status,'needs-verification');assert.ok(result.pitch.campaignId);assert.equal(store.state.applications[0].stage,'Saved');
  const c=store.state.campaigns[0];assert.equal(c.jobId,'job');assert.match(c.personalizedMessages[c.contactIds[0]].body,/Financial Analyst/);assert.equal((await queue.list()).filter(t=>t.kind==='campaign.send').length,0);
  assert.equal((await w.call('/api/jobs/job/auto-pitch',{})).status,202);assert.equal(store.db.prepare("SELECT count(*) AS n FROM tasks WHERE kind='job.auto-pitch'").get().n,1);
});
test('worker defaults on, bounded manual drain preserves future times, and outbound retries stay blocked',async t=>{
  const store=workspace(t),queue=taskQueue(store);assert.equal(embeddedWorkerEnabled({}),true);assert.equal(embeddedWorkerEnabled({RUN_EMBEDDED_WORKER:'false'}),false);assert.equal(embeddedWorkerEnabled({ENABLE_EMBEDDED_WORKER:'false',RUN_EMBEDDED_WORKER:'true'}),false);
  const future=await queue.enqueue('campaign.followup',{}, {runAt:Date.now()+86400000}),due=await queue.enqueue('mail.test-send',{accountId:'absent'},{maxAttempts:1});
  const pending=requestQueueDrain(store,queue,{},async()=>{throw Error('No sending');});assert.equal(requestQueueDrain(store,queue,{},fetch),pending);await pending;
  assert.equal((await queue.get(due.id)).status,'cancelled');assert.equal((await queue.get(future.id)).status,'queued');
  const outbound=await queue.enqueue('mail.test-send',{}, {maxAttempts:3}),claimed=await queue.claim(outbound.id);await queue.finish(claimed,null,Error('Unknown acceptance'));assert.equal((await queue.get(outbound.id)).status,'unknown');await assert.rejects(async()=>queue.retry(outbound.id),/Only failed/);
});
test('extension packages configure the live origin with an expiring one-use code, never workspace credentials; CORS is capability scoped',async t=>{
  const store=workspace(t),w=await apiWorkspace(t,store),origin='chrome-extension://'+'a'.repeat(32),pair=await packagePairing(store,w.config,w.base),zip=zipEntries(await extensionPackage(pair)),config=JSON.parse(zip['veloce-ai-extension/config.json']);
  assert.equal(config.serverUrl,w.base);assert.ok(!zip['veloce-ai-extension/config.json'].includes(Buffer.from('owner-test')));const manifest=JSON.parse(zip['veloce-ai-extension/manifest.json']);assert.ok(manifest.host_permissions.includes(`${w.base}/*`));
  const redemption=await redeemPackage({code:pair.pairingCode},store,w.config);assert.match(redemption.token,/^[A-Za-z0-9_-]{43}$/);await assert.rejects(redeemPackage({code:pair.pairingCode},store,w.config),/expired|used/);
  const preflight=await fetch(w.base+'/api/extension/profile',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Headers':'authorization'}});assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);assert.match(preflight.headers.get('access-control-allow-headers'),/Authorization/);
  const privateAPI=await fetch(w.base+'/api/state',{headers:{Origin:origin}});assert.equal(privateAPI.status,401);assert.equal(privateAPI.headers.has('access-control-allow-origin'),false);
  assert.equal((await fetch(w.base+'/api/extension/profile',{headers:{Origin:origin,Authorization:`Bearer ${redemption.token}`}})).status,200);
});
test('binary PDF and compressed DOCX extraction preserve original bytes for subsequent downloads and attachment',async t=>{
  const store=workspace(t),pdf=await renderTextPDF({title:'Resume',subtitle:'Casey Quinn',sections:[{heading:'Experience',lines:['Built Excel forecasts and SQL reports.']}]});
  const parsed=await parseResumeAsync({name:'original.pdf',base64:pdf.toString('base64')});assert.match(parsed.resume.text,/Casey Quinn/);assert.ok(!parsed.resume.text.includes('%PDF-'));
  const saved=await persistResume(parsed.resume,store);assert.deepEqual(Buffer.from((await hydrateResume(saved,store)).base64,'base64'),pdf);
  store.state.resume=saved;await store.save();const w=await apiWorkspace(t,store);const download=await w.call('/api/profile/resume-file');assert.equal(download.headers.get('content-type'),'application/pdf');assert.deepEqual(Buffer.from(await download.arrayBuffer()),pdf);
  const name=Buffer.from('word/document.xml'),xml=Buffer.from('<w:document><w:p>Casey Quinn &amp; team</w:p><w:p>Financial Analyst</w:p></w:document>'),compressed=deflateRawSync(xml),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(compressed.length,18);local.writeUInt16LE(name.length,26);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(xml.length,24);central.writeUInt16LE(name.length,28);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,10);end.writeUInt32LE(local.length+name.length+compressed.length,16);
  const docx=Buffer.concat([local,name,compressed,central,name,end]);assert.match((await parseResumeAsync({name:'resume.docx',base64:docx.toString('base64')})).resume.text,/Casey Quinn & team\nFinancial Analyst/);
});
test('browser import reads only visible company people and saves unverified work suggestions, not invented verified contacts',async t=>{
  const dom=new JSDOM('<h1>Deloitte</h1><ul><li><a href="https://www.linkedin.com/in/riley-quinn/">Riley Quinn</a><div class="artdeco-entity-lockup__subtitle">Technical Recruiter at Deloitte</div></li><li hidden><a href="https://linkedin.com/in/hidden/">Hidden Person</a>Recruiter</li></ul>',{url:'https://www.linkedin.com/company/deloitte/people/',runScripts:'outside-only'});t.after(()=>dom.window.close());
  const data=dom.window.eval(`(${extractLinkedInCompanyPeople.toString()})()`);assert.equal(data.profiles.length,1);const store=workspace(t),queue=taskQueue(store),result=await queueBrowserContacts(data,store,queue),task=await queue.get(result.taskId);await importBrowserContacts(task,store,{},async()=>new Response('',{status:403}),{lookupMx:mx});
  assert.equal(store.state.contacts[0].email,'riley.quinn@deloitte.com');assert.equal(store.state.contacts[0].emailStatus,'unverified');assert.equal(store.state.contacts[0].source,'Browser-visible LinkedIn profile');
});
test('OAuth callback follows the live request and is bound to the original flow; mailbox errors reveal only allowed diagnostic reasons',async t=>{
  const store=workspace(t),config={TOKEN_ENCRYPTION_KEY:key,GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'secret'},req={headers:{host:'orbit-test.onrender.com'}};
  const start=new URL(await startOAuth('google',store,config,req));assert.equal(start.searchParams.get('redirect_uri'),'https://orbit-test.onrender.com/api/oauth/google/callback');
  let redirect;await completeOAuth('google','code',start.searchParams.get('state'),store,config,async(url,options)=>{if(String(url).includes('/token')){redirect=new URLSearchParams(options.body).get('redirect_uri');return response({access_token:'access',refresh_token:'refresh',expires_in:3600});}return response({emailAddress:'self@candidate.com'});},{headers:{host:'other-host.test'}});assert.equal(redirect,start.searchParams.get('redirect_uri'));
  const failure=await mailFailure(new Response(JSON.stringify({error:{message:'private access-token and user data',errors:[{reason:'accessNotConfigured'}]}}),{status:403}),'Google');assert.match(failure.message,/Enable the Gmail API/);assert.ok(!failure.message.includes('private access'));
});
test('new stores are empty, demo cleanup preserves real data and mailbox grants, and application backups round-trip without duplicates',async t=>{
  const store=openStore(':memory:');t.after(()=>store.close());assert.equal(store.state.isDemo,false);assert.equal(store.state.jobs.length,0);
  const demo=initialState(true),real={id:'real',company:'Real Company',title:'Analyst',url:'https://real-company.test/job/1',isDemo:false,tags:[]};demo.jobs.push(real);demo.contacts.push({id:'real-contact',name:'Real Person',email:'hr@real-company.test',company:'Real Company',isDemo:false});demo.profile.name='Actual owner';demo.profile.email='owner@candidate.com';store.replace(demo);
  store.db.prepare('INSERT INTO mail_accounts(id,provider,email,secret,metadata) VALUES(?,?,?,?,?)').run('connected','google','owner@candidate.com','encrypted-unrelated','{}');
  const w=await apiWorkspace(t,store);assert.equal((await w.call('/api/workspace/clear-demo-data',{confirmed:true})).status,200);await store.refresh();assert.equal(store.state.jobs.length,1);assert.equal(store.state.contacts.length,1);assert.equal(store.state.profile.name,'Actual owner');assert.ok(store.db.prepare('SELECT id FROM mail_accounts').get());
  const data={csv:'Company,Role,Stage,URL,Notes\nReal Company,Analyst,Applied,https://real-company.test/job/1,"Notes, with comma"'};
  assert.equal((await (await w.call('/api/applications/import',data)).json()).imported,1);assert.equal((await (await w.call('/api/applications/import',data)).json()).skipped,1);
  const csv=await (await w.call('/api/export/applications')).text();assert.match(csv,/Notes, with comma/);assert.match(csv,/Applied/);
});
test('self-mail tests require explicit consent, use only the connected address and deduplicate repeats',async t=>{
  const store=workspace(t),w=await apiWorkspace(t,store),queue=taskQueue(store),cipher=tokenCipher(w.config);
  store.db.prepare('INSERT INTO mail_accounts(id,provider,email,secret,metadata) VALUES(?,?,?,?,?)').run('self','google','self@candidate.com',cipher.seal({access_token:'private',expires_at:Date.now()+3600000}),'{}');
  assert.equal((await w.call('/api/mail/self/test-send',{})).status,400);const first=await (await w.call('/api/mail/self/test-send',{confirmed:true,to:'someone@unrelated.test'})).json(),again=await (await w.call('/api/mail/self/test-send',{confirmed:true})).json();assert.equal(first.taskId,again.taskId);assert.equal(first.to,'self@candidate.com');
  let to;const registry=handlers(store,queue,w.config,async(_url,options)=>{const raw=Buffer.from(JSON.parse(options.body).raw,'base64url').toString();to=raw.match(/^To: (.*)$/m)[1].trim();return response({id:'accepted-self-test',threadId:'thread'});});
  assert.equal((await runOne(store,queue,registry,first.taskId)).status,'completed');assert.equal(to,'self@candidate.com');const status=await (await w.call('/api/mail/self/test-status')).json();assert.equal(status.tests.send.status,'accepted');
});

test('Veloce LinkedIn drafts stay below clipboard limits without invented background claims',async()=>{
  const {linkedInDrafts}=await import('../server/services/job-pitch.mjs');
  const normal=linkedInDrafts({title:'Financial Analyst',company:'Deloitte'},{name:'Riley Quinn'},{name:'Casey Quinn'});
  assert.match(normal.connectionNote,/Financial Analyst/);assert.match(normal.connectionNote,/Deloitte/);assert.match(normal.connectionNote,/Riley/);
  for(const size of [1,100,2000]){const drafts=linkedInDrafts({title:'Finance '.repeat(size),company:'Company '.repeat(size)},{name:'😀'.repeat(size)},{name:'Casey '.repeat(size)});assert.ok(drafts.connectionNote.length<200);assert.ok(drafts.followUpDM.length<450);assert.ok(!/[\uD800-\uDBFF]$/.test(drafts.connectionNote));}
  assert.ok(!normal.connectionNote.includes('years'));
});
test('manager, recruiter and peer drafts use distinct factual angles and bounded LinkedIn notes',async()=>{
  const {draftAutopilotPitch}=await import('../server/services/ai.mjs'),{linkedInDrafts}=await import('../server/services/job-pitch.mjs');
  const state=initialState(false);Object.assign(state.profile,{name:'Casey Quinn',skills:['Excel','Valuation']});state.resume={text:'Built Excel forecasts for a student project.\nReviewed valuation models.'};
  const job={title:'Financial Analyst',company:'Company',description:'Excel and valuation modeling',url:'https://company.com/jobs/1'},drafts={};
  for(const persona of ['manager','peer','recruiter']){
    const contact={name:'Riley Patel',company:'Company',persona},draft=await draftAutopilotPitch(state,job,contact,'https://candidate.com/resume',{useAI:false},{},()=>assert.fail('Templates do not call AI'));
    drafts[persona]=draft;assert.ok(draft.evidence.every(e=>state.resume.text.includes(e)));assert.ok(!/five years|increased revenue|saved \$|built a DCF/i.test(draft.body));
    const note=linkedInDrafts(job,contact,state.profile);assert.ok(note.connectionNote.length<200);assert.ok(note.followUpDM.length<450);assert.equal(note.angle,draft.angle);assert.match(note.connectionNote,/Financial Analyst/);
  }
  assert.match(drafts.manager.body,/relevant example from my résumé/);assert.match(drafts.manager.body,/Built Excel forecasts/);assert.match(drafts.peer.body,/10 minutes/);assert.match(drafts.peer.body,/internal referral/);assert.match(drafts.recruiter.body,/role-fit summary/);assert.match(drafts.recruiter.body,/•/);
  const overridden=await draftAutopilotPitch(state,job,{name:'Riley',persona:'manager'},'',{useAI:false,pitchAngle:'referral'},{});assert.equal(overridden.angle,'referral');
});
test('career-page imports are owner-only, asynchronous and persist the detected ATS without a provider call on the request',async t=>{
  const store=workspace(t),w=await apiWorkspace(t,store);
  const unauth=await fetch(w.base+'/api/search/career-pages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://company.com/careers'})});assert.equal(unauth.status,401);
  const result=await w.call('/api/search/career-pages',{url:'https://jobs.eu.lever.co/new-employer/'});assert.equal(result.status,202);const body=await result.json();assert.equal(body.board.source,'Lever EU');assert.equal(body.status,'pending');
  const boards=await w.call('/api/search/career-pages');assert.equal((await boards.json()).boards[0].status,'pending');
});
test('bounded bootstrap keeps tracked jobs while paginated search and freshness filters cover the whole index',async t=>{
  const store=workspace(t),template=store.state.jobs[0];
  store.state.jobs=Array.from({length:650},(_,i)=>({...template,id:`pool-${i}`,company:i===648?'Rare Company':`Company ${i}`,url:`https://company.com/jobs/${i}`,source:'Company',publishedAt:i===648?new Date().toISOString():'2025-01-01T00:00:00Z'}));
  store.state.applications=[{id:'tracked-tail',jobId:'pool-649',stage:'Saved'}];await store.save();
  const w=await apiWorkspace(t,store),response=await w.call('/api/bootstrap'),bootstrap=await response.json();
  assert.equal(bootstrap.data.jobFeed.total,650);assert.equal(bootstrap.data.jobFeed.truncated,true);assert.ok(bootstrap.data.jobs.length<=501);assert.ok(bootstrap.data.jobs.some(j=>j.id==='pool-649'));
  const page=await (await w.call('/api/jobs/feed?view=all&offset=600&limit=20')).json();assert.equal(page.total,650);assert.equal(page.jobs.length,20);
  const rare=await (await w.call('/api/jobs/feed?q=Rare%20Company&view=all')).json();assert.equal(rare.jobs[0].id,'pool-648');
  const fresh=await (await w.call('/api/jobs/feed?firstMover=true&view=all')).json();assert.equal(fresh.total,1);assert.equal(fresh.jobs[0].firstMover,true);assert.ok(!JSON.stringify(fresh).includes('detailCacheKey'));
});
test('simultaneous auto-pitch requests reuse one durable preparation without waiting for external APIs',async t=>{
  const store=workspace(t),w=await apiWorkspace(t,store),started=Date.now();
  const results=await Promise.all(Array.from({length:4},()=>w.call('/api/jobs/job/auto-pitch',{})));
  assert.ok(Date.now()-started<5000);assert.ok(results.every(r=>r.status===202));const bodies=await Promise.all(results.map(r=>r.json()));
  assert.equal(new Set(bodies.map(r=>r.pitch.taskId)).size,1);assert.equal(store.db.prepare("SELECT count(*) AS n FROM tasks WHERE kind='job.auto-pitch'").get().n,1);
});
test('outreach reservations are idempotent across campaigns for a normalized email and role, including uncertain sends',async t=>{
  const {queueCampaign}=await import('../server/services/outreach.mjs'),{campaignFingerprint}=await import('../server/domain.mjs');
  const store=workspace(t),queue=taskQueue(store),s=store.state;s.contacts=[{id:'r',name:'Riley',email:'HR@deloitte.com',company:'Deloitte',emailStatus:'verified',isDemo:false,suppressed:false}];
  const make=id=>({id,name:id,jobId:'job',subject:'About the analyst role',body:'Hi {{first_name}}, may we discuss this role?',contactIds:['r'],deliveries:[],status:'Draft',attachResume:false});
  const first=make('first'),second=make('second');s.campaigns=[first,second];
  for(const c of s.campaigns)s.previews[c.id]={campaignId:c.id,expires:Date.now()+60000,fingerprint:campaignFingerprint(c,s)};
  await store.save();const config={ENABLE_LIVE_SEND:'true',RESEND_API_KEY:'test-no-network',EMAIL_FROM:'casey@candidate.com'},approve=c=>({previewId:c.id,approved:true,confirmCount:1});
  const a=await queueCampaign(first,approve(first),store,queue,config),b=await queueCampaign(second,approve(second),store,queue,config);
  assert.equal(b.existing,true);assert.equal(b.deliveries[0].taskId,a.deliveries[0].taskId);assert.equal((await queue.list()).filter(t=>t.kind==='campaign.send').length,1);
  const row=store.db.prepare('SELECT * FROM outreach_job_reservations').get();assert.equal(row.contact_email,'hr@deloitte.com');assert.equal(row.job_id,'job');
  store.db.prepare("UPDATE outreach_send_log SET status='unknown' WHERE task_id=?").run(a.deliveries[0].taskId);
  const repeated=await queueCampaign(second,approve(second),store,queue,config);assert.equal(repeated.existing,true);assert.equal((await queue.list()).length,1);
  assert.throws(()=>store.db.prepare('INSERT INTO outreach_job_reservations(workspace_id,contact_email,job_id,campaign_id,task_id,created_at) VALUES(?,?,?,?,?,?)').run('local','HR@deloitte.com','job','rogue','rogue',Date.now()),/CHECK/);
});
test('document editing creates a new private PDF version and preserves the previously approved bytes',async t=>{
  const {ensureJobDocuments,hydrateDocument}=await import('../server/services/job-documents.mjs');
  const store=workspace(t),w=await apiWorkspace(t,store),queue=taskQueue(store);
  const original=await ensureJobDocuments(store.state.jobs[0],store,queue,{}),before=await hydrateDocument(original,'resume',store,{});
  const editor=await (await w.call(`/api/documents/${original.id}/editor`)).json();assert.ok(editor.model.sections.length);
  editor.model.sections.unshift({heading:'Profile',lines:['Financial analyst focused on Excel forecasting and SQL reporting.']});editor.model.coverLetter=['Dear Hiring Team,','I am applying for the Financial Analyst position.','Kind regards, Casey Quinn'];
  assert.equal((await w.call(`/api/documents/${original.id}/revisions`,{model:editor.model})).status,400);
  const request=await (await w.call(`/api/documents/${original.id}/revisions`,{model:editor.model,confirmed:true})).json();
  const done=await runOne(store,queue,handlers(store,queue,{}),request.task.id);assert.equal(done.status,'completed');await store.refresh();
  const next=store.state.jobDocuments.find(d=>d.id===done.result.documentId);assert.notEqual(next.id,original.id);assert.equal(next.method,'User-reviewed edits');
  assert.equal((await hydrateDocument(original,'resume',store,{})).base64,before.base64);assert.notEqual(next.resume.contentHash,original.resume.contentHash);
  const parsed=await parseResumeAsync(await hydrateDocument(next,'resume',store,{}));assert.match(parsed.resume.text,/Financial analyst focused on Excel/);
  assert.equal((await w.call(`/api/documents/${next.id}/resume`)).headers.get('content-type'),'application/pdf');
});
test('SSE uses unbuffered headers, a 20-second heartbeat, and cleans up its interval',async t=>{
  const {taskEvents}=await import('../server/events.mjs'),{EventEmitter}=await import('node:events');
  t.mock.timers.enable({apis:['setInterval']});const res=new EventEmitter();res.parts=[];res.writeHead=(status,headers)=>{res.status=status;res.headers=headers;};res.write=value=>res.parts.push(value);res.end=()=>{res.writableEnded=true;res.emit('close');};
  const events=taskEvents({list:async()=>[]});await events.connect({},res);assert.equal(res.headers['X-Accel-Buffering'],'no');assert.equal(res.headers['Cache-Control'],'no-cache, no-transform');
  t.mock.timers.tick(19999);assert.equal(res.parts.filter(p=>p===': heartbeat\n\n').length,0);t.mock.timers.tick(1);assert.equal(res.parts.filter(p=>p===': heartbeat\n\n').length,1);
  res.end();t.mock.timers.tick(20000);assert.equal(res.parts.filter(p=>p===': heartbeat\n\n').length,1);events.close();
});
test('provider deadlines abort hung adapters, and independent public pages and search begin concurrently',async()=>{
  const {withDeadline}=await import('../server/providers/deadline.mjs'),{findPublicContacts}=await import('../server/providers/contacts/free-xray.mjs');
  let aborted=false;await assert.rejects(withDeadline(signal=>new Promise(()=>signal.addEventListener('abort',()=>{aborted=true;})),20),/deadline/);assert.equal(aborted,true);
  let pageStarted=false,searchStarted=false,release;const gate=new Promise(resolve=>{release=resolve;}),fetcher=async()=>{searchStarted=true;if(pageStarted)release();await gate;return new Response('No public profiles');};
  const found=await findPublicContacts({company:'Deloitte',description:'',url:'https://deloitte.com/job'},{domain:'deloitte.com'},{searchPeople:true,fetcher,pages:async()=>{pageStarted=true;if(searchStarted)release();await gate;return [{url:'https://deloitte.com/careers',text:'jobs@deloitte.com'}];}});
  assert.equal(pageStarted && searchStarted,true);assert.equal(found[0].email,'jobs@deloitte.com');assert.equal(found[0].emailStatus,'unverified');
});
test('workspace branding rejects injected CSS and kanban transitions persist with a manual audit trail',async t=>{
  const store=workspace(t),w=await apiWorkspace(t,store);
  const invalid=await w.call('/api/settings',{brand:{name:'Custom',accent:'red;display:none'}});assert.equal(invalid.status,400);
  const settings={...store.state.settings,brand:{name:'Casey Careers',accent:'#06B6D4'}};assert.equal((await w.call('/api/settings',settings)).status,200);await store.refresh();assert.equal(store.state.settings.brand.name,'Casey Careers');
  const created=await (await w.call('/api/applications',{jobId:'job',stage:'Saved'})).json();await store.refresh();const id=store.state.applications[0].id;
  for(const stage of ['Applied','Outreach Sent','Assessment','Interview','Offer','Archived']) {
    const response=await fetch(w.base+`/api/applications/${id}`,{method:'PATCH',headers:w.headers,body:JSON.stringify({stage})});assert.equal(response.status,200);await store.refresh();assert.equal(store.state.applications[0].stage,stage);assert.equal(store.state.applications[0].history.at(-1).source,'Manual');if(stage==='Outreach Sent'){assert.equal((await w.call('/api/apply/queue',{jobIds:['job'],approved:true})).status,202);await store.refresh();assert.equal(store.state.applications[0].stage,'Outreach Sent');}
  }
});
test('company logos use bounded provider raster assets without opening an arbitrary URL proxy',async()=>{
  const {providerLogoURL,companyLogos}=await import('../server/services/company-logos.mjs');
  for(const value of ['http://127.0.0.1/private','https://attacker.test/logo.png','https://remotive.com@attacker.test/logo','data:image/svg+xml,<svg/>'])assert.equal(providerLogoURL(value),'');
  let requests=0;const png=Buffer.from('89504e470d0a1a0a00000000','hex'),logo=companyLogos(async(_url,options)=>{requests++;assert.equal(options.redirect,'error');assert.ok(options.signal);return new Response(png);});
  const job={companyLogo:'https://remotive.com/job/123/logo'};assert.equal((await logo(job)).type,'image/png');assert.equal((await logo(job)).bytes.toString('hex'),png.toString('hex'));assert.equal(requests,1);
  const invalid=companyLogos(async()=>new Response('<svg><script>alert(1)</script></svg>'));assert.equal(await invalid(job),null);
});
test('floating copilot mounts an accessible open Shadow DOM without inserting global host-page CSS',async()=>{
  const source=await readFile(new URL('../extension/copilot.js',import.meta.url),'utf8'),dom=new JSDOM('<style>button {font-size:80px!important}</style><p>Host application</p>',{url:'https://jobs.lever.co/example/role',runScripts:'outside-only'});
  try{dom.window.eval(source);const host=dom.window.document.getElementById('orbit-career-copilot');assert.ok(host.shadowRoot);assert.equal(host.shadowRoot.mode,'open');assert.match(host.shadowRoot.querySelector('#launch').textContent,/Veloce/);assert.match(host.shadowRoot.querySelector('style').textContent,/:host\{all:initial/);assert.equal(dom.window.document.querySelectorAll('style').length,1);assert.equal(host.style.getPropertyPriority('z-index'),'important');}finally{dom.window.close();}
});

test('authenticated SSE connections create long-lived timers outside the workspace snapshot',async t=>{
  const store=workspace(t),detach=store.detached;let calls=0;store.detached=fn=>{calls++;return detach(fn);};
  const w=await apiWorkspace(t,store),res=await w.call('/api/events');assert.equal(res.status,200);assert.match(res.headers.get('content-type'),/text\/event-stream/);assert.equal(calls,1);await res.body.cancel();
});
