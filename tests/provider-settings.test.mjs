import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../server/store.mjs';
import {initialState} from '../server/fixtures.mjs';
import {createApp} from '../server/index.mjs';
import {saveProviderKey,effectiveProviderConfig,providerConfigView,withProviderConfig} from '../server/services/provider-config.mjs';
import {verifyProvider} from '../server/services/provider-verification.mjs';
import {providerCall} from '../server/services/provider-budget.mjs';
const encryption={TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')};
function clean(t){const store=openStore(':memory:');store.replace(initialState(false));t.after(()=>store.close());return store;}
const response=data=>new Response(JSON.stringify(data));

test('saved keys are encrypted, override server keys, isolate concurrent contexts and migrate legacy workspace values',async t=>{
  const store=clean(t),base={...encryption,HUNTER_API_KEY:'server-key'};
  store.state.connections={hunterApiKey:' legacy-workspace-key '};await store.save();
  assert.equal((await effectiveProviderConfig(store,base)).HUNTER_API_KEY,'legacy-workspace-key');
  assert.ok(!JSON.stringify(store.state).includes('legacy-workspace-key'));
  assert.ok(!store.db.prepare("SELECT secret FROM provider_credentials WHERE id='hunter'").get().secret.includes('legacy-workspace-key'));
  await saveProviderKey('hunter',' replacement-key ',store,base);
  assert.equal((await effectiveProviderConfig(store,base)).HUNTER_API_KEY,'replacement-key');
  const view=providerConfigView(base);
  await Promise.all(['workspace-a','workspace-b'].map(key=>withProviderConfig({...base,HUNTER_API_KEY:key},async()=>{await new Promise(r=>setImmediate(r));assert.equal(view.HUNTER_API_KEY,key);assert.equal({...view}.HUNTER_API_KEY,key);})));
  assert.equal(view.HUNTER_API_KEY,'server-key');
  await store.replace(initialState(false));assert.equal((await effectiveProviderConfig(store,base)).HUNTER_API_KEY,'replacement-key','Workspace reset preserves provider configuration');
});

test('provider key APIs enforce authentication and origin, never return keys, and report exact free account usage',async t=>{
  const store=clean(t),app=createApp({store,config:{...encryption,WORKSPACE_PASSWORD:'test',ENABLE_JOB_DISCOVERY:'false',HUNTER_API_KEY:'server-fallback'},fetcher:async input=>{
    const u=new URL(input);assert.equal(u.pathname,'/v2/account');assert.equal(u.searchParams.get('api_key'),'workspace-hunter-key');return response({data:{requests:{searches:{available:25,used:1},verifications:{available:50,used:3}}}});
  }});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{app.events.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));});
  const base=`http://127.0.0.1:${app.server.address().port}`,headers={'Content-Type':'application/json',Authorization:`Basic ${Buffer.from('orbit:test').toString('base64')}`};
  assert.equal((await fetch(`${base}/api/connections/providers`)).status,401);
  const path=`${base}/api/connections/providers/hunter`,body=JSON.stringify({key:' workspace-hunter-key '});
  assert.equal((await fetch(path,{method:'PUT',headers:{...headers,Origin:'https://other.example'},body})).status,403);
  assert.equal((await fetch(path,{method:'PUT',headers,body})).status,200);
  const verified=await fetch(`${base}/api/connections/verify-provider`,{method:'POST',headers,body:JSON.stringify({provider:'hunter'})});assert.equal(verified.status,200);
  const check=await verified.json();assert.equal(check.ok,true);assert.deepEqual(check.usage.searches,{total:25,used:1,remaining:24});
  for(const route of ['/api/connections/providers','/api/state','/api/bootstrap']){const r=await fetch(base+route,{headers}),text=await r.text();assert.equal(r.status,200,text);assert.ok(!text.includes('workspace-hunter-key'));assert.ok(!text.includes('server-fallback'));}
  assert.equal((await fetch(path,{method:'DELETE',headers})).status,200);
  assert.equal((await effectiveProviderConfig(store,{...encryption,HUNTER_API_KEY:'server-fallback'})).HUNTER_API_KEY,'server-fallback');
});

test('live checks redact provider errors, cache repeated tests, and require explicit metered-check intent',async t=>{
  const store=clean(t),base={...encryption,SERPER_API_KEY:'private-serper',HUNTER_API_KEY:'private-hunter'};let calls=0;
  await assert.rejects(verifyProvider('serper',store,base,async()=>assert.fail('No search permitted')),/Confirm/);
  const fetcher=async()=>{calls++;return response({organic:[],credits:1});};
  assert.equal((await verifyProvider('serper',store,base,fetcher,{confirmMetered:true})).ok,true);
  assert.equal((await verifyProvider('serper',store,base,fetcher,{confirmMetered:true})).cached,true);assert.equal(calls,1);
  const check=await verifyProvider('hunter',store,base,async()=>new Response(JSON.stringify({errors:[{details:'Invalid key private-hunter'}]}),{status:401}));
  assert.equal(check.ok,false);assert.equal(check.httpStatus,401);assert.match(check.message,/Invalid key \[redacted\]/);assert.ok(!JSON.stringify(store.state).includes('private-hunter'));
});

test('credit reservations permit distinct network requests concurrently, coalesce duplicates, and hold ambiguous failures',async t=>{
  const store=clean(t);let active=0,peak=0,calls=0;
  const work=async()=>{calls++;active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,15));active--;return {ok:true};};
  const results=await Promise.all([providerCall(store,'person-a','Serper',2,work),providerCall(store,'person-b','Tavily',2,work),providerCall(store,'person-a','Serper',2,work)]);
  assert.equal(results.length,3);assert.equal(calls,2);assert.equal(peak,2);
  await assert.rejects(providerCall(store,'person-c','Serper',2,work),/Daily optional search/);
  await assert.rejects(providerCall(store,'uncertain','Hunter',3,async()=>{throw Error('network lost');}),/network lost/);
  await assert.rejects(providerCall(store,'uncertain','Hunter',3,()=>assert.fail('Must not spend again')),/held/);
});
