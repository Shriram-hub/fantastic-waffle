import {ensureJobDocuments,hydrateDocument} from '../server/services/job-documents.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { openPostgresStore, postgresSQL } from '../server/db/postgres-store.mjs';
import { taskQueue } from '../server/queue.mjs';
import { createApp } from '../server/index.mjs';
import { handlers,runOne } from '../server/worker.mjs';
import { hydrateResume } from '../server/services/resume-storage.mjs';
import {putCatalogJobs,queryCatalog,importWorkspaceCatalog} from '../server/services/job-catalog.mjs';
import {buildSearchPlan} from '../server/services/search-plan.mjs';
import {saveProviderKey,effectiveProviderConfig} from '../server/services/provider-config.mjs';
import {companyDirectory} from '../server/services/company-explorer.mjs';
import {prepareQuickBatch,launchQuickBatch,batchProgress} from '../server/services/quick-mailer.mjs';
import {tokenCipher} from '../server/providers/mail/oauth.mjs';
test('Postgres company filters and mail-studio progress use durable rows and deduplicate a repeated reviewed launch',async t=>{
  const db=new PGlite();t.after(()=>db.close());const store=await openPostgresStore({},poolFor(db)),{initialState}=await import('../server/fixtures.mjs'),state=initialState(false),config={TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,3).toString('base64'),ENABLE_LIVE_SEND:'true'};
  Object.assign(state.profile,{name:'Casey Quinn',email:'casey@candidate.com',skills:['SQL'],interests:['Engineer']});state.contacts=[{id:'riley',name:'Riley',email:'riley@company.com',company:'Company',title:'Recruiter',emailStatus:'verified',suppressed:false,isDemo:false}];await store.replace(state);
  await store.db.prepare('INSERT INTO mail_accounts(id,provider,email,secret,metadata) VALUES(?,?,?,?,?)').run('mail','google','casey@candidate.com',tokenCipher(config).seal({access_token:'test',expires_at:Date.now()+3600000}),'{}');
  await store.run(async()=>{const directory=await companyDirectory(store,{q:'Lazard'});assert.equal(directory.companies[0].name,'Lazard');const review=await prepareQuickBatch({accountId:'mail',contactIds:['riley'],subject:'{{role}} at {{company}}',body:'Hello {{firstName}}, I use {{myTopSkill}}.'},store,config),approval={...review,approved:true,confirmCount:1};
    const first=await launchQuickBatch(approval,store,taskQueue(store),config),second=await launchQuickBatch(approval,store,taskQueue(store),config);assert.equal(first.progress.queued,1);assert.equal(second.existing,true);assert.equal((await batchProgress(review.campaignId,store)).total,1);
  });
});
function poolFor(db) {
  const query=async(sql,params=[]) => {
    if (!params.length && sql.includes(';')) { const values=await db.exec(sql); const result=values.at(-1);return {rows:result?.rows || [],rowCount:result?.affectedRows || 0}; }
    const result=await db.query(sql,params);return {rows:result.rows,rowCount:result.affectedRows || 0};
  };
  return {query,async connect(){return{query,release(){}};},async end(){}};
}
test('Postgres catalogue paging and encrypted credentials persist separately from workspace snapshots',async t=>{
  const db=new PGlite();t.after(()=>db.close());const pool=poolFor(db),store=await openPostgresStore({},pool),config={TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,2).toString('base64')};
  const {initialState}=await import('../server/fixtures.mjs');await store.replace(initialState(false));
  await store.run(async()=>{
    const plan=buildSearchPlan(store.state,{roles:['Financial Analyst']});await saveProviderKey('serper','pg-private-key',store,config);
    await putCatalogJobs(Array.from({length:22},(_,i)=>({id:`pg-catalog-${i}`,company:`Company ${i}`,title:'Financial Analyst',description:'Excel forecasting',url:`https://company.com/jobs/${i}`,location:'Remote',workMode:'Remote',source:'Lever'})),plan,store);
    await importWorkspaceCatalog(store,plan);const first=await queryCatalog(store,plan,{limit:20}),last=await queryCatalog(store,plan,{limit:20,cursor:first.nextCursor});assert.equal(first.total,22);assert.equal(last.jobs.length,2);assert.equal(store.state.jobs.length,0);
  });
  const reopened=await openPostgresStore({},pool);assert.equal((await effectiveProviderConfig(reopened,config)).SERPER_API_KEY,'pg-private-key');assert.equal(reopened.state.jobs.length,0);assert.ok(!JSON.stringify(reopened.state).includes('pg-private-key'));
});
test('PostgreSQL runtime persists API records, private files, and worker state across connections',async t => {
  const db=new PGlite();t.after(()=>db.close());const pool=poolFor(db);
  const store=await openPostgresStore({},pool),app=createApp({store,config:{}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{app.events.close();app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const request=async(path,data,method='POST') => {
    const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const body=await r.json();assert.ok(r.ok,JSON.stringify(body));return body;
  };
  await request('/api/workspace/reset',{confirm:'START_FRESH'});
  await request('/api/profile',{...store.state.profile,name:'Postgres owner',email:'owner@candidate.com',skills:['SQL'],interests:['Engineering']},'PUT');
  const result=await request('/api/resume',{name:'resume.txt',base64:Buffer.from('Postgres owner\nSQL and React engineer').toString('base64')});
  const workerStore=await openPostgresStore({},pool),queue=taskQueue(workerStore);
  const done=await runOne(workerStore,queue,handlers(workerStore,queue,{}),result.task.id);
  assert.equal(done.status,'completed');
  await workerStore.refresh();
  assert.equal(workerStore.state.resume.storage.kind,'postgres');
  assert.equal((await hydrateResume(workerStore.state.resume,workerStore,{})).base64,Buffer.from('Postgres owner\nSQL and React engineer').toString('base64'));
  const reopened=await openPostgresStore({},pool);
  assert.equal(reopened.state.profile.name,'Postgres owner');
  assert.equal(reopened.state.profile.master.personal.fullName,'Postgres owner');
  assert.ok(reopened.state.profile.master.skills.technical.includes('SQL'));
  assert.equal((await taskQueue(reopened).get(result.task.id)).status,'completed');
  assert.equal((await reopened.db.prepare('SELECT count(*) AS count FROM resume_objects').get()).count,1);
  const job={id:'pdf-job',company:'Example Company',title:'Analyst',description:'Build SQL models and review financial statements.',url:'https://company.test/jobs/1'};reopened.state.jobs.push(job);await reopened.save();
  const documents=await ensureJobDocuments(job,reopened,taskQueue(reopened));assert.ok(documents);
  const durable=await openPostgresStore({},pool),saved=durable.state.jobDocuments.find(d=>d.id===documents.id);
  assert.equal(saved.resume.base64,undefined);assert.equal(saved.resume.storage.kind,'postgres');
  assert.ok(Buffer.from((await hydrateDocument(saved,'resume',durable,{})).base64,'base64').subarray(0,5).toString()==='%PDF-');
  assert.ok(Buffer.from((await hydrateDocument(saved,'coverLetter',durable,{})).base64,'base64').subarray(0,5).toString()==='%PDF-');

});
test('PostgreSQL rejects stale writes and atomically deduplicates queue tasks',async t=>{
  const db=new PGlite();t.after(()=>db.close());const pool=poolFor(db);
  const a=await openPostgresStore({},pool),b=await openPostgresStore({},pool);
  a.state.profile.name='Winner';await a.save();
  b.state.profile.name='Stale';await assert.rejects(b.save(),/changed/);
  const queue=taskQueue(a);
  const first=await queue.enqueue('test',{a:1},{dedupeKey:'same'}),second=await queue.enqueue('test',{a:1},{dedupeKey:'same'});
  assert.equal(first.id,second.id);
  const claimed=await queue.claim(first.id);assert.equal(claimed.status,'running');
  assert.equal(await queue.claim(first.id),null);await queue.finish(claimed,{done:true});
  assert.equal((await queue.get(first.id)).status,'completed');
  assert.equal(postgresSQL("SELECT '?' FROM tasks WHERE id=?"),"SELECT '?' FROM orbit_runtime.tasks WHERE id=$1");
});
test('Postgres preserves contact discovery, provenance, planner tasks, stories and interview guides across worker reconnects',async t=>{
  const {initialState}=await import('../server/fixtures.mjs'),{saveCareerTask,saveCareerStory,prepFingerprint}=await import('../server/services/career.mjs'),{startContactDiscovery}=await import('../server/services/contact-discovery.mjs');
  const db=new PGlite();t.after(()=>db.close());const pool=poolFor(db),store=await openPostgresStore({},pool),queue=taskQueue(store),state=initialState(false);
  state.jobs=[{id:'pg-role',company:'Company',title:'Financial Analyst',description:'Build financial models and analyze financial reports.',source:'Company',url:'https://company.com/careers/1',tags:['Excel'],location:'Mumbai',workMode:'On-site',isDemo:false}];await store.replace(state);
  await store.run(()=>saveCareerTask({title:'Prepare for interview',jobId:'pg-role',dueAt:'2026-11-01T05:00:00Z'},store));
  await store.run(()=>saveCareerStory({title:'Forecasting project',action:'Built a model from the supplied accounts.'},store));
  const batch=await store.run(()=>startContactDiscovery({source:'domains',domains:['company.com'],contactsPerCompany:1},store,queue,{}));
  const workerStore=await openPostgresStore({},pool),workerQueue=taskQueue(workerStore),registry=handlers(workerStore,workerQueue,{},()=>assert.fail('No paid API expected'),{lookupMx:async()=>[{exchange:'mx.company.com'}],contactPages:async()=>[{url:'https://company.com/careers',text:'Recruiting: hr@company.com'}]});
  assert.equal((await runOne(workerStore,workerQueue,registry,batch.run.targets[0].taskId)).status,'completed');
  await workerStore.refresh();const prep=await workerQueue.enqueue('career.prep',{jobId:'pg-role',useAI:false,fingerprint:prepFingerprint(workerStore,workerStore.state.jobs[0],false)});assert.equal((await runOne(workerStore,workerQueue,registry,prep.id)).status,'completed');
  const reopened=await openPostgresStore({},pool);assert.equal(reopened.state.career.tasks[0].title,'Prepare for interview');assert.equal(reopened.state.career.stories.length,1);assert.equal(reopened.state.career.prep.length,1);assert.equal(reopened.state.contacts[0].verification.reference,'https://company.com/careers');assert.equal(reopened.state.contactDiscoveryRuns[0].targets[0].status,'completed');assert.equal((await reopened.db.prepare('SELECT company_domain FROM contacts').get()).company_domain,'company.com');
});
test('Postgres login sessions survive reconnects, remain private and protect the complete bootstrap path',async t=>{
  const db=new PGlite();t.after(()=>db.close());const pool=poolFor(db),store=await openPostgresStore({},pool);
  const app=createApp({store,config:{WORKSPACE_PASSWORD:'pg-test-only',ENABLE_JOB_DISCOVERY:'false',AUTOPILOT_CRON_SECRET:'cron-test'}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{app.events.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const result=await fetch(base+'/api/auth/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'pg-test-only'})});
  assert.equal(result.status,200);const cookie=result.headers.getSetCookie()[0].split(';')[0];
  assert.equal((await fetch(base+'/api/bootstrap',{headers:{Cookie:cookie}})).status,200);
  const reopened=await openPostgresStore({},pool);assert.equal((await reopened.db.prepare('SELECT count(*) AS n FROM auth_sessions').get()).n,1);
  await store.replace(store.state);assert.equal((await reopened.db.prepare('SELECT count(*) AS n FROM auth_sessions').get()).n,1);
  const check=await fetch(base+'/api/internal/workspace-check',{method:'POST',headers:{'X-Orbit-Scheduler':'cron-test'}});assert.equal(check.status,200);assert.equal((await check.json()).ok,true);
  assert.equal(postgresSQL('SELECT body FROM auth_sessions WHERE id=?'),'SELECT body FROM orbit_runtime.auth_sessions WHERE id=$1');
});

test('PostgreSQL outreach commits approvals, reserves recipients, enforces budgets and records provider acceptance',async t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-19T09:00:00Z')});
  const {initialState}=await import('../server/fixtures.mjs');
  const {normalizeContact,campaignFingerprint}=await import('../server/domain.mjs');
  const {queueCampaign}=await import('../server/services/outreach.mjs');
  const db=new PGlite();t.after(()=>db.close());const store=await openPostgresStore({},poolFor(db)),queue=taskQueue(store);
  const state=initialState(false);
  state.profile={...state.profile,name:'Casey Quinn',email:'casey@candidate.com'};
  state.settings.sendTimeZone='UTC';
  state.contacts=[normalizeContact({name:'Riley',email:'hr@company.com',company:'Company',email_status:'verified'},'CSV')];
  const campaign={id:'pg-campaign',name:'Hello',subject:'Hello {{first_name}}',body:'I am {{my_name}}.',contactIds:state.contacts.map(c=>c.id),attachResume:false,deliveries:[],status:'Draft'};
  state.campaigns=[campaign];
  state.previews.test={campaignId:campaign.id,expires:Date.now()+600000,fingerprint:campaignFingerprint(campaign,state)};
  await store.replace(state);
  const config={ENABLE_LIVE_SEND:'true',RESEND_API_KEY:'mock-only',EMAIL_FROM:'casey@candidate.com'};
  await store.run(async()=>queueCampaign(store.state.campaigns[0],{previewId:'test',approved:true,confirmCount:1},store,queue,config));
  let sends=0;
  const result=await runOne(store,queue,handlers(store,queue,config,async(url,options)=>{sends++;assert.match(JSON.parse(options.body).headers['List-Unsubscribe'],/\/u\//);return new Response(JSON.stringify({id:'mock-postgres-send'}));}));
  assert.equal(result.status,'completed');assert.equal(sends,1);
  const row=await store.db.prepare('SELECT * FROM outreach_send_log').get();assert.equal(row.status,'accepted');assert.equal(row.provider_id,'mock-postgres-send');
  assert.equal((await store.db.prepare('SELECT count FROM send_budget').get()).count,1);
  await assert.rejects(store.db.prepare("INSERT INTO outreach_send_log(user_id,contact_email,campaign_id,sequence_step,task_id,status,updated_at) VALUES('local',?,?,0,'duplicate','queued',?)").run(row.contact_email,row.campaign_id,Date.now()),/duplicate key|unique constraint/i);
});

test('Supabase TLS trusts the official CA and keeps certificate/hostname verification enabled',async()=>{
  const {postgresPoolOptions}=await import('../server/db/postgres-store.mjs');
  const {X509Certificate}=await import('node:crypto');
  const options=await postgresPoolOptions({DATABASE_URL:'postgresql://orbit_app.project:private@aws-0-us-east-2.pooler.supabase.com:5432/postgres?sslmode=verify-full'});
  assert.equal(options.ssl.rejectUnauthorized,true);
  assert.equal(new URL(options.connectionString).searchParams.has('sslmode'),false);
  const certificate=new X509Certificate(options.ssl.ca);assert.equal(certificate.ca,true);assert.match(certificate.subject,/Supabase/);
  assert.equal(certificate.verify(certificate.publicKey),true);
  await assert.rejects(postgresPoolOptions({DATABASE_URL:'postgresql://user:password@db.project.supabase.co/postgres?sslmode=disable'}),/verified TLS/);
});

test('PostgreSQL snapshot cache avoids repeated full index reads and observes another worker’s committed revision',async t=>{
  const db=new PGlite();t.after(()=>db.close());const base=poolFor(db);let fullReads=0;
  const count=(sql)=>{if(sql.includes('UNION ALL'))fullReads++;};
  const counted={...base,async query(sql,params){count(sql);return base.query(sql,params);},async connect(){const client=await base.connect();return {...client,async query(sql,params){count(sql);return client.query(sql,params);}};}};
  const a=await openPostgresStore({},counted),b=await openPostgresStore({},base);
  const first=fullReads;await a.refresh();await a.run(async()=>assert.ok(a.state.profile));assert.equal(fullReads,first);
  b.state.profile.name='New profile from worker';await b.save();
  await a.refresh();assert.equal(a.state.profile.name,'New profile from worker');assert.equal(fullReads,first+1);
  await a.refresh();assert.equal(fullReads,first+1);
});

test('PostgreSQL reuses a role/email reservation across campaigns and exposes a real worker heartbeat',async t=>{
  const {initialState}=await import('../server/fixtures.mjs'),{campaignFingerprint}=await import('../server/domain.mjs'),{queueCampaign}=await import('../server/services/outreach.mjs'),{workerHeartbeat,workerStatus}=await import('../server/services/worker-health.mjs');
  const db=new PGlite();t.after(()=>db.close());const pool=poolFor(db),store=await openPostgresStore({},pool),queue=taskQueue(store),state=initialState(false);
  Object.assign(state.profile,{name:'Casey Quinn',email:'casey@candidate.com'});state.jobs=[{id:'job',company:'Company',title:'Analyst',tags:[]}];state.contacts=[{id:'contact',email:'hr@company.com',emailStatus:'verified',name:'Hiring Team',company:'Company',isDemo:false,suppressed:false}];
  const make=id=>({id,jobId:'job',name:id,subject:'Analyst',body:'Hi {{first_name}}',contactIds:['contact'],deliveries:[],status:'Draft',attachResume:false});state.campaigns=[make('one'),make('two')];
  for(const c of state.campaigns)state.previews[c.id]={campaignId:c.id,fingerprint:campaignFingerprint(c,state),expires:Date.now()+60000};await store.replace(state);
  const config={ENABLE_LIVE_SEND:'true',RESEND_API_KEY:'test',EMAIL_FROM:'casey@candidate.com'};
  const prepare=id=>store.run(()=>queueCampaign(store.state.campaigns.find(c=>c.id===id),{previewId:id,approved:true,confirmCount:1},store,queue,config));
  const first=await prepare('one'),second=await prepare('two');assert.equal(second.existing,true);assert.equal(second.deliveries[0].taskId,first.deliveries[0].taskId);assert.equal((await queue.list()).length,1);
  await assert.rejects(store.db.prepare('INSERT INTO outreach_job_reservations(workspace_id,contact_email,job_id,campaign_id,task_id,created_at) VALUES(?,?,?,?,?,?)').run('local','hr@company.com','job','third','third',Date.now()),/duplicate key|unique constraint/i);
  assert.equal((await workerStatus(store)).status,'offline');await workerHeartbeat(store,'processing');assert.equal((await workerStatus(store)).status,'processing');await store.db.prepare('UPDATE worker_health SET heartbeat_at=?').run(Date.now()-60000);assert.equal((await workerStatus(store)).status,'offline');
});

test('PostgreSQL detached timers release request snapshots and session context',async t=>{
  const db=new PGlite();t.after(()=>db.close());const store=await openPostgresStore({},poolFor(db)),root=store.state;let later;
  await store.run(async()=>{
    const request=store.state;request.profile.name='Unsaved request';
    later=store.detached(()=>new Promise(resolve=>setImmediate(()=>resolve(store.state))));
    assert.equal(store.state,request);
  });
  assert.equal(await later,root);assert.notEqual((await later).profile.name,'Unsaved request');
});

test('PostgreSQL pages large indexes, coalesces refreshes and isolates mutable working records',async t=>{
  const {initialState}=await import('../server/fixtures.mjs');
  const db=new PGlite();t.after(()=>db.close());const base=poolFor(db);let loads=0,pages=0,largestPage=0,failNext=false;
  const counted={...base,async connect(){const client=await base.connect();return {...client,async query(sql,params){
    if(sql.includes('UNION ALL'))loads++;
    if(sql.includes('job_listings WHERE row_order>')) {
      if(failNext){failNext=false;throw Object.assign(Error('Transient read failure'),{code:'ECONNRESET'});}
      const result=await client.query(sql,params);pages++;largestPage=Math.max(largestPage,result.rows.length);return result;
    }
    return client.query(sql,params);
  }};}};
  const a=await openPostgresStore({},counted),b=await openPostgresStore({},base),state=initialState(false);
  state.jobs=Array.from({length:601},(_,i)=>({id:`paged-${i}`,title:'Analyst',company:`Company ${i}`,tags:['SQL'],description:`Role ${i}. `+'Requirements '.repeat(160)}));
  await b.replace(state);const before=loads,states=[];
  await Promise.all(Array.from({length:6},()=>a.run(async()=>{states.push(a.state);assert.equal(a.state.jobs.length,601);})));
  assert.equal(loads,before+1);assert.equal(largestPage,256);assert.ok(pages>=3);
  states[0].jobs[0].tags.push('Unsaved');assert.deepEqual(states[1].jobs[0].tags,['SQL']);
  let shared;
  await a.run(async()=>{
    shared=a.state.jobs[0];assert.ok(Object.isFrozen(shared));assert.ok(Object.isFrozen(shared.tags));
    assert.throws(()=>shared.tags.push('Unsafe mutation'),TypeError);a.state.profile.name='Unsaved read';
    await assert.rejects(a.save(),/read-only/);
  },{readOnlyJobs:true});
  await a.run(async()=>{assert.equal(a.state.jobs[0],shared);assert.notEqual(a.state.profile.name,'Unsaved read');},{readOnlyJobs:true});
  await a.run(async()=>{assert.deepEqual(a.state.jobs[0].tags,['SQL']);a.state.jobs[0].title='Changed safely';await a.save();});
  await b.refresh();assert.equal(b.state.jobs[0].title,'Changed safely');assert.deepEqual(b.state.jobs[0].tags,['SQL']);
  b.state.profile.name='Invalidate cache';await b.save();failNext=true;
  await assert.rejects(a.refresh(),/Transient read failure/);
  await a.refresh();assert.equal(a.state.profile.name,'Invalidate cache');
  a.releaseRoot();assert.throws(()=>a.state,/scoped/);
  await a.run(async()=>{assert.equal(a.state.jobs.length,601);a.state.profile.name='Scoped worker';await a.save();});
  await b.refresh();assert.equal(b.state.profile.name,'Scoped worker');
});
