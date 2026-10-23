import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../server/store.mjs';
import {initialState} from '../server/fixtures.mjs';
import {createApp} from '../server/index.mjs';
import {handlers,runOne} from '../server/worker.mjs';
import {careerStatus,saveCareerTask,saveCareerStory,plannerCalendar,prepFingerprint} from '../server/services/career.mjs';
import {taskQueue} from '../server/queue.mjs';
import {QUESTION_BANK,INTERVIEW_TRACKS,gradeInterviewAnswer,evaluateInterviewAnswer} from '../server/services/career.mjs';

test('six interview banks cover finance, accounting, consulting and software with deterministic source-grounded feedback',async t=>{
  const store=await workspace(t);store.state.profile.skills=['Excel','WACC'];store.state.career={weeklyGoal:10,tasks:[],prep:[],stories:[{title:'Model review',action:'I reviewed WACC assumptions in an Excel model.',result:'The team used the documented assumptions.'}]};
  assert.equal(INTERVIEW_TRACKS.length,6);for(const track of ['finance','accounting','consulting','software'])assert.ok(QUESTION_BANK[track].length>=5);
  const question=QUESTION_BANK.finance.find(q=>q.id==='fin-dcf'),answer='First I would forecast free cash flow. Next I would discount cash flows at WACC and estimate terminal value. I would compare a 10% discount rate with a 12% rate in a sensitivity analysis. Finally I would explain which assumptions drive the result.';
  const result=gradeInterviewAnswer({answer,question,elapsedSeconds:110},store.state);assert.ok(result.score>=0 && result.score<=100);assert.equal(Object.values(result.scores).reduce((a,b)=>a+b,0),result.score);assert.ok(Object.values(result.scores).every(n=>n>=0 && n<=25));assert.ok(!result.missingKeywords.includes('wacc'));assert.ok(result.evidenceKeywords.includes('Excel'));assert.match(result.modelAnswer,/WACC/);assert.ok(!result.modelAnswer.includes('increased revenue by'));
  const weak=gradeInterviewAnswer({answer:'I would check the numbers.',question},store.state);assert.ok(weak.score<result.score);assert.ok(weak.missingKeywords.includes('terminal value'));
  const local=await evaluateInterviewAnswer({track:'accounting',questionId:'acc-assertions',answer:'I would request the ledger and invoices and review the evidence.'},store,{},()=>assert.fail('No key must not make an external call'));assert.equal(local.method,'Local practice rubric');assert.ok(local.modelAnswer.length>100);
});
test('mock interview API validates bank questions, answer limits and AI consent; Gemini failure falls back without inventing evidence',async t=>{
  const store=await workspace(t),app=createApp({store,config:{ENABLE_JOB_DISCOVERY:'false'},fetcher:()=>assert.fail('No-key evaluation must be offline')});await app.ready;
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{app.events.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));});
  const base=`http://127.0.0.1:${app.server.address().port}`,post=data=>fetch(base+'/api/career/evaluate-answer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const bank=await (await fetch(base+'/api/career/questions?track=finance')).json();assert.ok(bank.questions.some(q=>q.id==='fin-dcf'));assert.ok(bank.questions.every(q=>!q.reference));
  const input={jobId:'role',track:'finance',questionId:'fin-dcf',answer:'I would forecast free cash flow, discount at WACC and test terminal value.'};
  const valid=await post(input);assert.equal(valid.status,200);assert.ok((await valid.json()).missingKeywords.includes('sensitivity'));
  assert.equal((await post({...input,questionId:'arbitrary'})).status,400);assert.equal((await post({...input,answer:'x'.repeat(6001)})).status,400);assert.equal((await post({...input,useAI:true})).status,400);
  const fallback=await evaluateInterviewAnswer({...input,useAI:true,confirmed:true},store,{LLM_API_KEY:'test',LLM_MODEL:'model'},async()=>new Response('busy',{status:503}));assert.match(fallback.warning,/unavailable/);assert.equal(fallback.method,'Local practice rubric');
});

async function workspace(t) {
  const store=openStore(':memory:');t.after(()=>store.close());const state=initialState(false);
  state.jobs=[{id:'role',company:'Company',title:'Financial Analyst',description:'Build financial models and analyze cash flow. Collaborate with the finance team.',url:'https://company.com/careers/1',tags:['Excel','Valuation'],location:'Mumbai',workMode:'On-site',isDemo:false}];
  state.resume={text:'Prepared cash flow models using Excel.'};await store.replace(state);return store;
}
test('planner saves dates and real story fields, detects stale edits, and marks overdue work without sending anything',async t=>{
  const store=await workspace(t),at=Date.now()-3600000;
  const task=await saveCareerTask({title:'Follow up',jobId:'role',dueAt:new Date(at).toISOString(),kind:'Follow-up',notes:'Ask about next steps'},store);
  assert.equal(careerStatus(store).stats.overdue,1);assert.equal(careerStatus(store).due[0].jobId,'role');
  await assert.rejects(saveCareerTask({notes:'Stale',expectedUpdatedAt:'old'},store,task.id),/changed/);
  await saveCareerTask({done:true},store,task.id);assert.equal(careerStatus(store).stats.overdue,0);
  await assert.rejects(saveCareerTask({title:'Invalid',dueAt:'tomorrow'},store),/valid due date/);
  await assert.rejects(saveCareerTask({title:'Invalid',jobId:'unknown'},store),/existing job/);
  const story=await saveCareerStory({title:'Financial model',situation:'A cash flow forecast was needed.',action:'I built a model.',result:'Stakeholders reviewed it.'},store);
  await assert.rejects(saveCareerStory({result:'Overwrite',expectedUpdatedAt:'old'},store,story.id),/changed/);
  assert.equal(store.state.career.stories[0].task,'');assert.equal(store.state.campaigns.length,0);
});
test('calendar preserves absolute times, escapes notes, folds long Unicode lines and excludes completed tasks',async t=>{
  const store=await workspace(t),due='2026-11-01T10:30:00+05:30';
  await saveCareerTask({title:'Interview, finance; café '.repeat(6),dueAt:due,jobId:'role',notes:'Line one\nBEGIN:VEVENT\nInjected, text; remains notes.'},store);
  const done=await saveCareerTask({title:'Completed',dueAt:due},store);await saveCareerTask({done:true},store,done.id);
  const calendar=plannerCalendar(store),unfolded=calendar.replaceAll('\r\n ','');assert.match(calendar,/DTSTART:20261101T050000Z/);assert.equal((calendar.match(/\r\nBEGIN:VEVENT/g)||[]).length,1);assert.ok(!calendar.includes('SUMMARY:Completed'));assert.match(unfolded,/Line one\\nBEGIN:VEVENT\\nInjected\\, text\\;/);
  for(const line of calendar.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75,`Long line: ${Buffer.byteLength(line)}`);
});
test('search analytics count recorded submissions and interviews, not prepared applications',async t=>{
  const store=await workspace(t),at=new Date().toISOString();
  store.state.applications=[{id:'a',stage:'Ready',createdAt:at,history:[]},{id:'b',stage:'Interview scheduled',createdAt:at,history:[{stage:'Applied',at},{stage:'Interview scheduled',at}]},{id:'c',stage:'Offer',createdAt:at,history:[{stage:'Applied',at},{stage:'Interview',at},{stage:'Offer',at}]}];
  const stats=careerStatus(store).stats;assert.equal(stats.tracked,3);assert.equal(stats.submitted,2);assert.equal(stats.appliedLast7Days,2);assert.equal(stats.interviews,2);assert.equal(stats.offers,1);
});
test('template interview guide is asynchronous, job-specific and reusable, while stale resume work cancels',async t=>{
  const store=await workspace(t),queue=taskQueue(store),job=store.state.jobs[0],fingerprint=prepFingerprint(store,job,false);
  const task=await queue.enqueue('career.prep',{jobId:job.id,useAI:false,fingerprint});
  const done=await runOne(store,queue,handlers(store,queue,{},()=>assert.fail('Template must not call AI')),task.id);assert.equal(done.status,'completed');
  await store.refresh();
  assert.equal(store.state.career.prep.length,1);assert.equal(store.state.career.prep[0].questions[0].answerNotes,'');assert.ok(store.state.career.prep[0].questions.every(q=>!q.jobQuote || job.description.includes(q.jobQuote)));
  const stale=await queue.enqueue('career.prep',{jobId:job.id,useAI:false,fingerprint});store.state.resume.text='Changed resume';await store.save();assert.equal((await runOne(store,queue,handlers(store,queue,{}),stale.id)).status,'cancelled');
});
test('private career API requires owner auth, approves AI explicitly and keeps full practice notes out of bootstrap',async t=>{
  const store=await workspace(t),app=createApp({store,config:{WORKSPACE_PASSWORD:'test',ENABLE_JOB_DISCOVERY:'false',LLM_API_KEY:'not-returned',LLM_MODEL:'test'}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{app.events.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));});
  const base=`http://127.0.0.1:${app.server.address().port}`,headers={Authorization:`Basic ${Buffer.from('orbit:test').toString('base64')}`,'Content-Type':'application/json'};
  assert.equal((await fetch(base+'/api/career')).status,401);assert.equal((await fetch(base+'/api/career/calendar.ics')).status,401);
  const create=await fetch(base+'/api/career/tasks',{method:'POST',headers,body:JSON.stringify({title:'Interview',jobId:'role',notes:'private-full-task-notes',dueAt:'2026-11-01T05:00:00Z'})});assert.equal(create.status,201);
  const noApproval=await fetch(base+'/api/career/prep',{method:'POST',headers,body:JSON.stringify({jobId:'role',useAI:true})});assert.equal(noApproval.status,400);
  const bootstrap=await (await fetch(base+'/api/bootstrap',{headers})).text();assert.ok(!bootstrap.includes('private-full-task-notes'));assert.ok(!bootstrap.includes('not-returned'));
  const status=await (await fetch(base+'/api/career',{headers})).json();assert.equal(status.aiConfigured,true);assert.equal(status.tasks.length,1);
});
test('Gemini practice guide validates exact job quotes and never fills candidate answers',async t=>{
  const store=await workspace(t),queue=taskQueue(store),job=store.state.jobs[0],config={LLM_PROVIDER:'gemini',LLM_MODEL:'test-gemini',LLM_API_KEY:'test-only'};
  const questions=[{question:'How would you build this financial model?',jobQuote:'Build financial models and analyze cash flow.'},{question:'How do you collaborate with finance stakeholders?',jobQuote:'Collaborate with the finance team.'},{question:'Tell me about a challenging professional project.',jobQuote:''},{question:'Invented requirement?',jobQuote:'A requirement that is absent.'},{question:'What is your marital status?',jobQuote:''}];
  const task=await queue.enqueue('career.prep',{jobId:job.id,useAI:true,fingerprint:prepFingerprint(store,job,true)});
  const done=await runOne(store,queue,handlers(store,queue,config,async url=>{assert.match(String(url),/generativelanguage.googleapis.com/);return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({questions,companyQuestions:['What does success look like?']})}]}}]}));}),task.id);
  assert.equal(done.status,'completed');await store.refresh();assert.equal(store.state.career.prep[0].questions.length,3);assert.ok(store.state.career.prep[0].questions.every(q=>q.answerNotes===''));
});
