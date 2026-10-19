import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { openPostgresStore, postgresSQL } from '../server/db/postgres-store.mjs';
import { taskQueue } from '../server/queue.mjs';
import { createApp } from '../server/index.mjs';
import { handlers,runOne } from '../server/worker.mjs';
import { hydrateResume } from '../server/services/resume-storage.mjs';
function poolFor(db) {
  const query=async(sql,params=[]) => {
    if (!params.length && sql.includes(';')) { const values=await db.exec(sql); const result=values.at(-1);return {rows:result?.rows || [],rowCount:result?.affectedRows || 0}; }
    const result=await db.query(sql,params);return {rows:result.rows,rowCount:result.affectedRows || 0};
  };
  return {query,async connect(){return{query,release(){}};},async end(){}};
}
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
  assert.equal((await taskQueue(reopened).get(result.task.id)).status,'completed');
  assert.equal((await reopened.db.prepare('SELECT count(*) AS count FROM resume_objects').get()).count,1);
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
  const counted={...base,async query(sql,params){if(sql.includes('UNION ALL'))fullReads++;return base.query(sql,params);}};
  const a=await openPostgresStore({},counted),b=await openPostgresStore({},base);
  const first=fullReads;await a.refresh();await a.run(async()=>assert.ok(a.state.profile));assert.equal(fullReads,first);
  b.state.profile.name='New profile from worker';await b.save();
  await a.refresh();assert.equal(a.state.profile.name,'New profile from worker');assert.equal(fullReads,first+1);
  await a.refresh();assert.equal(fullReads,first+1);
});
