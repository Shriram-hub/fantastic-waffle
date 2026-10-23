import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFile} from 'node:fs/promises';
import {extractLinkedInCompanyPeople,extractLinkedInProspect} from '../extension/linkedin.mjs';
const name=i=>`Person ${String.fromCharCode(65+Math.floor(i/26))}${String.fromCharCode(65+i%26)}`;
const cards=(start,end)=>Array.from({length:end-start},(_,n)=>{const i=start+n;return `<div class="org-people-profile-card"><a href="/in/person-${i}/?trk=people"><span aria-hidden="true">${name(i)}</span></a><div class="artdeco-entity-lockup__subtitle">Senior Financial Analyst</div><div class="artdeco-entity-lockup__caption">Mumbai</div></div>`;}).join('');
test('serialized People harvester accumulates lazy and virtualized cards, normalizes 100 profiles and never clicks navigation',async t=>{
  const dom=new JSDOM(`<main><h1>Company</h1><div id="cards">${cards(0,25)}</div></main><aside>${cards(101,102)}</aside>`,{url:'https://www.linkedin.com/company/company/people/',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window;let position=25,scrolls=0,clicks=0;
  w.document.addEventListener('click',()=>clicks++);w.scrollBy=()=>{scrolls++;const next=Math.min(100,position+25);w.document.getElementById('cards').innerHTML=cards(position,next);position=next;};w.scrollTo=()=>{};
  const found=await w.eval(`(${extractLinkedInCompanyPeople.toString()})({targetCount:100,duration:40})`);assert.equal(found.profiles.length,100);assert.equal(new Set(found.profiles.map(p=>p.profileUrl)).size,100);assert.equal(found.company,'Company');assert.equal(found.profiles[0].location,'Mumbai');assert.ok(found.profiles.every(p=>p.title==='Senior Financial Analyst'));assert.ok(scrolls>=3);assert.equal(clicks,0);assert.ok(!found.profiles.some(p=>p.profileUrl.includes('101')));
});
test('individual Get email reads only the active profile header and current company, leaving candidate-profile sync separate',t=>{
  const dom=new JSDOM('<main><section><h1>Maya Singh</h1><div class="text-body-medium">Finance Director</div><button aria-label="Current company: Company">Company</button><span class="text-body-small inline t-black--light">Mumbai</span></section></main><aside><h1>Someone Else</h1></aside>',{url:'https://www.linkedin.com/in/maya-singh/?trk=x',runScripts:'outside-only'});t.after(()=>dom.window.close());
  const found=dom.window.eval(`(${extractLinkedInProspect.toString()})()`);assert.equal(found.company,'Company');assert.equal(found.profiles[0].name,'Maya Singh');assert.equal(found.profiles[0].title,'Finance Director');assert.equal(found.profiles[0].linkedinUrl,'https://www.linkedin.com/in/maya-singh');
});
test('manifest and packaged UI include profile Get email and People search without broader browsing permissions',async()=>{
  const manifest=JSON.parse(await readFile('extension/manifest.json','utf8')),matches=manifest.content_scripts.flatMap(c=>c.matches);assert.ok(matches.includes('https://www.linkedin.com/in/*'));assert.ok(matches.includes('https://www.linkedin.com/search/results/people/*'));assert.ok(!manifest.host_permissions.includes('<all_urls>'));
  const popup=await readFile('extension/popup.html','utf8');assert.match(popup,/Get email for this LinkedIn profile/);assert.match(popup,/Harvest 50–100 Employees from Page/);
});

test('Get email travels from the extension action through bearer API, worker enrichment and result polling without modifying the candidate profile',async t=>{
  const {createApp}=await import('../server/index.mjs'),{initialState}=await import('../server/fixtures.mjs'),{handlers,runOne}=await import('../server/worker.mjs'),{runInNewContext}=await import('node:vm');
  const app=createApp({dataDir:':memory:',config:{ENABLE_JOB_DISCOVERY:'false',WORKSPACE_PASSWORD:'owner'},fetcher:async()=>assert.fail('No paid or page API required')});await app.ready;const state=initialState(false);state.profile.name='Workspace Owner';await app.store.replace(state);await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${app.server.address().port}`,token=(await (await fetch(base+'/api/extension/token',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Basic '+Buffer.from('orbit:owner').toString('base64')},body:'{}'})).json()).token;
  const dom=new JSDOM('<main><section><h1>Maya Singh</h1><div class="text-body-medium">Director of Finance</div><button aria-label="Current company: Deloitte">Deloitte</button></section></main>',{url:'https://www.linkedin.com/in/maya-singh/',runScripts:'outside-only'});t.after(async()=>{dom.window.close();app.events.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));app.store.close();});
  const listeners=[],saved={base,token},tab={id:9,url:dom.window.location.href};
  const chrome={storage:{session:{get:async keys=>Object.fromEntries((typeof keys==='string'?[keys]:keys).map(k=>[k,saved[k]])),set:async v=>Object.assign(saved,v)}},runtime:{getURL:p=>'chrome-extension://orbit/'+p,onMessage:{addListener:fn=>listeners.push(fn)}},tabs:{get:async()=>tab,onRemoved:{addListener(){}}},scripting:{executeScript:async options=>[{result:await dom.window.eval(`(${options.func.toString()})(...${JSON.stringify(options.args || [])})`)}]}};
  const source=(await readFile('extension/background.mjs','utf8')).replace(/^import .+;\n/gm,'').replace(/^export /gm,'');runInNewContext(source,{chrome,fetch,URL,Response,AbortSignal,setTimeout,clearTimeout,extractLinkedInProspect,extractLinkedInCompanyPeople});
  const dispatch=(message,sender)=>new Promise((resolve,reject)=>{let handled=false;const timer=setTimeout(()=>reject(Error('No extension response')),2000);for(const fn of listeners)if(fn(message,sender,result=>{clearTimeout(timer);resolve(result);})===true)handled=true;if(!handled){clearTimeout(timer);reject(Error('No extension handler'));}});
  const queued=await dispatch({type:'linkedin-get-email',tabId:9},{url:'chrome-extension://orbit/popup.html'});assert.equal(queued.count,1);assert.ok(queued.taskId);assert.ok(!queued.error);
  const result=await runOne(app.store,app.queue,handlers(app.store,app.queue,{},async()=>assert.fail('No paid request'),{lookupMx:async()=>[{exchange:'mx.deloitte.com'}]}),queued.taskId);assert.equal(result.status,'completed');
  const polled=await dispatch({type:'browser-import-status',taskId:queued.taskId},{url:tab.url,tab:{id:9},frameId:0});assert.equal(polled.contacts[0].email,'maya.singh@deloitte.com');assert.equal(polled.contacts[0].emailStatus,'unverified');assert.equal(app.store.state.profile.name,'Workspace Owner');assert.equal(app.store.state.campaigns.length,0);
  const blocked=await dispatch({type:'linkedin-get-email'},{url:tab.url,tab:{id:9},frameId:2});assert.ok(blocked.error);
});
