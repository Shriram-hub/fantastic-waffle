import test from 'node:test';
import assert from 'node:assert/strict';
import {MasterProfileSchema,candidateFromText,candidateProfile,mergeCandidate,saveCandidate,parseDateRange} from '../server/services/candidate-profile.mjs';
import {initialState} from '../server/fixtures.mjs';
import {createApp} from '../server/index.mjs';
import {handlers,runOne} from '../server/worker.mjs';
import {suggestProfileAnswers} from '../server/services/ai.mjs';

test('master profile normalizes explicit history while retaining unknown eligibility and protected fields',()=>{
  const master=candidateFromText('Casey Quinn\ncasey@candidate.test\nExperience\nAcme Ltd\nFinancial Analyst\nJune 2023 – Present\n- Built financial models in Excel.\nEducation\nExample University\nB.Com\n2019 – 2022\nSkills\nExcel, Valuation');
  assert.equal(master.personal.firstName,'Casey');assert.equal(master.personal.lastName,'Quinn');
  assert.equal(master.workExperience[0].company,'Acme Ltd');assert.equal(master.workExperience[0].startMonth,'06');assert.equal(master.workExperience[0].startYear,'2023');assert.equal(master.workExperience[0].isCurrentRole,true);
  assert.equal(master.education[0].institution,'Example University');assert.equal(master.education[0].endYear,'2022');
  assert.equal(master.applicationDefaults.requiresVisaSponsorship,null);assert.equal(master.personal.citizenship,'');assert.equal(master.personal.dateOfBirth,'');assert.equal(master.applicationDefaults.totalYearsExperience,null);
  assert.deepEqual(parseDateRange('Jan 2020 - Dec 2022'),{startMonth:'01',startYear:'2020',endMonth:'12',endYear:'2022',isCurrentRole:false});
  assert.equal(candidateFromText('Financial Analyst\nSkills: Excel').personal.fullName,'');
});
test('imports fill missing values, preserve explicit false/zero and deduplicate repeating records',()=>{
  const profile=initialState(false).profile;
  const first=MasterProfileSchema.parse({personal:{fullName:'Casey Quinn',email:'saved@example.test'},workExperience:[{company:'Acme',title:'Analyst',startYear:'2023'}],applicationDefaults:{requiresVisaSponsorship:false,noticePeriodDays:0}});
  saveCandidate(profile,first);
  const second=MasterProfileSchema.parse({personal:{email:'new@example.test',city:'Mumbai'},workExperience:[{company:'Acme',title:'Analyst',startYear:'2023',description:'Worked on valuations.'},{company:'Beta',title:'Associate'}],applicationDefaults:{requiresVisaSponsorship:true}});
  saveCandidate(profile,second,{source:'LinkedIn'});
  assert.equal(profile.master.personal.email,'saved@example.test');assert.equal(profile.master.personal.city,'Mumbai');
  assert.equal(profile.master.applicationDefaults.requiresVisaSponsorship,false);assert.equal(profile.master.applicationDefaults.noticePeriodDays,0);
  assert.equal(profile.master.workExperience.length,2);assert.equal(profile.master.workExperience[0].description,'Worked on valuations.');assert.ok(profile.master.workExperience[0].id);
  assert.equal(mergeCandidate({value:false},{value:true}).value,false);
  assert.equal(candidateProfile({...profile,location:'Mumbai or Delhi'}).personal.city,'Mumbai');
});

async function appFor(t,config={}) {
  const app=createApp({dataDir:':memory:',config:{WORKSPACE_PASSWORD:'test-only',...config}});await app.store.replace(initialState(false));
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));await app.store.close();});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  return {...app,async call(path,data,method=data===undefined ? 'GET' : 'POST',auth=true){const r=await fetch(`${base}${path}`,{method,headers:{...(auth ? {Authorization:`Basic ${Buffer.from('owner:test-only').toString('base64')}`} : {}),...(data===undefined ? {} : {'Content-Type':'application/json'})},...(data===undefined ? {} : {body:JSON.stringify(data)})});const raw=await r.text();let json;try{json=JSON.parse(raw);}catch{}return {status:r.status,json,raw};}};
}
test('candidate vault survives ordinary profile saves and imported LinkedIn text does not replace the resume',async t=>{
  const app=await appFor(t);
  assert.equal((await app.call('/api/profile/master',undefined,'GET',false)).status,401);
  const master=MasterProfileSchema.parse({personal:{fullName:'Casey Quinn',email:'casey@example.test'},education:[{institution:'Example College',degree:'B.Com'}],applicationDefaults:{requiresVisaSponsorship:false}});
  assert.equal((await app.call('/api/profile/master',{master},'PUT')).status,200);
  assert.equal((await app.call('/api/profile/master',{master,expectedUpdatedAt:null},'PUT')).status,409,'An old form cannot overwrite an import that completed while it was open');
  const profile=(await app.call('/api/state')).json.profile;
  assert.equal((await app.call('/api/profile',{...profile,headline:'Finance analyst'},'PUT')).status,200);
  assert.equal((await app.call('/api/profile/master')).json.master.education.length,1);
  const contents='Casey Quinn\ncasey@example.test\nSkills: Excel';
  const upload=await app.call('/api/profile/parse-resume',{name:'resume.txt',base64:Buffer.from(contents).toString('base64')});assert.equal(upload.status,202);
  assert.equal((await runOne(app.store,app.queue,handlers(app.store,app.queue,{}),upload.json.task.id)).status,'completed');
  assert.equal((await app.call('/api/profile/resume-file')).raw,contents);
  const imported=await app.call('/api/profile/import-linkedin',{url:'https://www.linkedin.com/in/casey',text:'Casey Quinn\nExperience\nAcme\nFinancial Analyst\n2023 – Present\nBuilt Excel models.',useAI:false});assert.equal(imported.status,202);
  assert.equal((await app.call('/api/profile/master')).json.master.workExperience[0].company,'Acme');
  assert.equal((await app.call('/api/profile/resume-file')).raw,contents);
  assert.equal((await app.call('/api/profile/import-linkedin',{url:'https://127.0.0.1/private'})).status,400);
});
test('Gemini screening suggestions use exact professional excerpts and skip eligibility/demographic questions',async()=>{
  const master=MasterProfileSchema.parse({summary:{professionalSummary:'Built financial models in Excel.'}});
  let sent;
  const result=await suggestProfileAnswers([{id:'1',label:'Describe your relevant experience'},{id:'2',label:'Will you require visa sponsorship?'}],master,{title:'Financial Analyst'}, {LLM_PROVIDER:'gemini',LLM_MODEL:'gemini-test',LLM_API_KEY:'fake'},async(url,options)=>{sent=JSON.parse(options.body);return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({selections:[{id:'1',excerpt:'Built financial models in Excel.'},{id:'2',excerpt:'No sponsorship needed.'}]})}]}}]}));});
  assert.equal(result.answers.length,1);assert.equal(result.answers[0].answer,'Built financial models in Excel.');assert.ok(!sent.contents[0].parts[0].text.includes('Will you require visa sponsorship?'));assert.equal(result.unanswered.length,1);
});
test('queued deep extraction validates the master schema, persists history and cancels a stale resume',async t=>{
  const config={LLM_PROVIDER:'gemini',LLM_MODEL:'gemini-test',LLM_API_KEY:'fake'};
  const app=await appFor(t,config),source='Casey Quinn\nExperience\nAcme\nAnalyst\n2023 – Present\nBuilt financial models.';
  const upload=await app.call('/api/profile/parse-resume',{name:'resume.txt',base64:Buffer.from(source).toString('base64')});
  const expected=MasterProfileSchema.parse({personal:{fullName:'Casey Quinn'},workExperience:[{company:'Acme',title:'Analyst',startYear:'2023',isCurrentRole:true}],skills:{financeAndTools:['Financial Modeling']}});
  let calls=0;const fetcher=async(url,options)=>{calls++;const body=JSON.parse(options.body);assert.equal(body.generationConfig.responseJsonSchema.properties.workExperience.type,'array');return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(expected)}]}}]}));};
  const registry=handlers(app.store,app.queue,config,fetcher);
  assert.equal((await runOne(app.store,app.queue,registry,upload.json.task.id)).status,'completed');
  const task=(await app.queue.list()).find(t=>t.kind==='profile.extract');assert.ok(task);
  assert.equal((await runOne(app.store,app.queue,registry,task.id)).status,'completed');assert.equal(calls,1);
  assert.equal((await app.call('/api/profile/master')).json.master.workExperience[0].company,'Acme');
  assert.equal((await registry['profile.extract']({payload:{resumeHash:'stale-hash'}})).status,'cancelled');assert.equal(calls,1);
});
