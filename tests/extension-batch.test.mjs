import {sameApplicationLocation,sameApplicationHost} from '../extension/location.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('extension opens one batch tab at a time and advances only after a matching recent submission confirmation',async()=>{
  const listeners=[],state={base:'https://orbit.test',token:'mock'},tabs=new Map(),created=[],injections=[],submissions=[],available=[{id:'one',url:'https://boards.greenhouse.io/company/jobs/1',company:'Company',role:'Analyst'},{id:'two',url:'https://jobs.lever.co/company/2',company:'Company',role:'Analyst'}];
  const get=async keys=>Object.fromEntries((typeof keys==='string' ? [keys] : keys).map(key=>[key,state[key]]));
  const chrome={storage:{session:{get,set:async values=>Object.assign(state,values),remove:async keys=>{for(const key of typeof keys==='string' ? [keys] : keys)delete state[key];}}},runtime:{getURL:path=>`chrome-extension://orbit/${path}`,onMessage:{addListener:fn=>listeners.push(fn)}},permissions:{contains:async()=>true},webNavigation:{getAllFrames:async({tabId})=>[{frameId:0,url:tabs.get(tabId).url}]},scripting:{executeScript:async options=>{injections.push(options);return options.func ? [{result:{status:'needs-review',filled:1,missing:[],questions:[]}}] : [];},unregisterContentScripts:async()=>{},registerContentScripts:async()=>{}},tabs:{create:async options=>{const tab={id:created.length+20,status:'complete',...options};created.push(tab);tabs.set(tab.id,tab);return tab;},get:async id=>tabs.get(id),update:async(id,values)=>Object.assign(tabs.get(id),values),onUpdated:{addListener(){},removeListener(){}},onRemoved:{addListener(){}}}};
  const fetcher=async(url,options={})=>{
    const path=new URL(url).pathname,body=options.body ? JSON.parse(options.body) : {};
    if(path.endsWith('/next'))return new Response(JSON.stringify({task:available.find(t=>body.taskIds.includes(t.id) && !t.leased) ? (()=>{const t=available.find(t=>body.taskIds.includes(t.id) && !t.leased);t.leased=true;return t;})() : null}));
    if(path.endsWith('/context'))return new Response(JSON.stringify({profile:{},qa:[],resume:false}));
    if(path.endsWith('/documents'))return new Response(JSON.stringify({resume:{name:'resume.pdf',base64:'JVBERg=='},coverLetter:{name:'cover.pdf',base64:'JVBERg=='}}));
    if(path.endsWith('/submission'))submissions.push(body);
    return new Response('{}');
  };
  const source=(await readFile(new URL('../extension/background.mjs',import.meta.url),'utf8')).replace(/^import .+;\n/gm,'').replace(/^export /gm,'');
  runInNewContext(source,{sameApplicationLocation,sameApplicationHost,chrome,fetch:fetcher,URL,Response,AbortSignal,setTimeout,clearTimeout,buildAnswers:()=>({}),fillApplication:()=>{},fieldKey:v=>v,extractLinkedInProfile:()=>{}});
  const dispatch=(message,sender)=>new Promise((resolve,reject)=>{let handled=false;const timer=setTimeout(()=>reject(Error('Extension response timed out')),1000);for(const listener of listeners){if(listener(message,sender,result=>{clearTimeout(timer);resolve(result);})===true)handled=true;}if(!handled){clearTimeout(timer);reject(Error('No handler'));}});
  const start=await dispatch({type:'workspace-batch',taskIds:['one','two']},{url:'https://orbit.test/',tab:{id:77}});assert.ok(!start.error);assert.equal(created.length,1);assert.equal(state.currentTask.task.id,'one');assert.equal(submissions.length,0);assert.ok(injections.some(i=>i.args?.[2]?.coverLetter?.name==='cover.pdf'));
  const sender={url:created[0].url,tab:{id:created[0].id},frameId:0};
  await dispatch({type:'application-confirmation',evidence:'Application submitted'},sender);assert.equal(created.length,1);
  const mismatch=await dispatch({type:'submission-attempt'},{...sender,url:'https://other.greenhouse.io/wrong'});assert.ok(mismatch.error);assert.equal(submissions.length,0);
  await dispatch({type:'submission-attempt'},sender);assert.equal(submissions[0].status,'submission-pending');assert.equal(created.length,1);
  await dispatch({type:'application-confirmation',evidence:'Application submitted'},sender);assert.equal(created.length,2);assert.equal(state.batch.completed,1);assert.equal(state.currentTask.task.id,'two');
  assert.equal(submissions.filter(s=>s.status==='confirmed').length,1);
  await dispatch({type:'batch-pause'},{url:'chrome-extension://orbit/popup.html'});assert.equal(state.batch.paused,true);
  assert.equal(created.length,2);
});

test('queued application identity survives known Greenhouse redirects but cannot switch to another role on the same host',()=>{
  const expected='https://boards.greenhouse.io/company/jobs/123';
  assert.ok(sameApplicationLocation(expected,'https://job-boards.greenhouse.io/company/jobs/123/application?gh_src=test'));
  assert.equal(sameApplicationLocation(expected,'https://boards.greenhouse.io/company/jobs/456'),false);
  assert.equal(sameApplicationLocation('https://company.test/apply?jobId=1','https://company.test/apply?jobId=2'),false);
  assert.equal(sameApplicationHost('https://boards.eu.greenhouse.io/company/jobs/123',expected),false);
});
