import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {createApp} from '../server/index.mjs';
import {openStore} from '../server/store.mjs';
import {tokenCipher} from '../server/providers/mail/oauth.mjs';
import {hash} from '../server/domain.mjs';
import {initialState} from '../server/fixtures.mjs';

async function setup(t,{config={},fetcher,store}={}) {
  const options={WORKSPACE_PASSWORD:'test-password',TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,3).toString('base64'),GOOGLE_CLIENT_ID:'test-client.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'test-only',ENABLE_JOB_DISCOVERY:'false',...config};
  const app=createApp({dataDir:':memory:',config:options,fetcher,store});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  t.after(async()=>{app.events.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));if(!store)await app.store.close();});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const request=async(path,{body,cookie,headers={},...opts}={})=>{
    const r=await fetch(base+path,{redirect:'manual',...opts,headers:{...(body ? {'Content-Type':'application/json'} : {}),...(cookie ? {Cookie:cookie} : {}),...headers},...(body ? {method:'POST',body:JSON.stringify(body)} : {})});
    const raw=await r.text();return {status:r.status,headers:r.headers,body:raw.startsWith('{') ? JSON.parse(raw) : raw};
  };
  return {...app,options,request};
}
const cookie=r=>r.headers.getSetCookie().find(c=>c.startsWith('orbit_session='))?.split(';')[0];
async function unlock(w) {const r=await w.request('/api/auth/password',{body:{password:'test-password'}});assert.equal(r.status,200);return cookie(r);}

test('public sign-in shell and cookie sessions protect private data, reject CSRF, expire and revoke on logout',async t=>{
  const w=await setup(t);
  assert.equal((await w.request('/')).status,200);
  assert.equal((await w.request('/api/bootstrap')).status,401);
  assert.equal((await w.request('/api/bootstrap')).headers.has('www-authenticate'),false);
  const publicSession=await w.request('/api/auth/session');assert.equal(publicSession.body.googleConfigured,true);assert.equal(publicSession.body.authenticated,false);assert.ok(!JSON.stringify(publicSession).includes('test-only'));
  assert.equal((await w.request('/api/auth/password',{body:{password:'test-password'},headers:{Origin:'https://attacker.invalid'}})).status,403);
  assert.equal((await w.request('/api/auth/password',{body:{password:'wrong'}})).status,401);
  const token=await unlock(w);assert.match(token,/orbit_session=/);
  assert.equal((await w.request('/api/auth/session',{cookie:token})).body.method,'password');
  assert.equal((await w.request('/api/bootstrap',{cookie:token})).status,200);
  const row=w.store.db.prepare('SELECT * FROM auth_sessions').get();assert.ok(!row.id.includes(token.split('=')[1]));assert.ok(!row.body.includes('test-password'));
  assert.equal((await w.request('/api/auth/logout',{body:{},cookie:token,headers:{Origin:'https://attacker.invalid'}})).status,403);
  assert.equal((await w.request('/api/auth/logout',{body:{},cookie:token})).status,200);
  assert.equal((await w.request('/api/bootstrap',{cookie:token})).status,401);
  const cachedBasic='Basic '+Buffer.from('orbit:test-password').toString('base64');
  assert.equal((await w.request('/api/bootstrap',{headers:{Authorization:cachedBasic,'Sec-Fetch-Dest':'empty'}})).status,401);
  const again=await unlock(w);w.store.db.prepare('UPDATE auth_sessions SET expires=0').run();assert.equal((await w.request('/api/bootstrap',{cookie:again})).status,401);
});

test('password throttling is durable, secure cookies are HttpOnly and reset preserves the linked owner',async t=>{
  const w=await setup(t,{config:{PUBLIC_BASE_URL:'https://orbit.example'}});
  const result=await w.request('/api/auth/password',{body:{password:'test-password'}});
  assert.match(result.headers.get('set-cookie'),/__Host-orbit_session=.*HttpOnly; SameSite=Lax; Max-Age=604800; Secure/);
  const identity=()=>w.store.db.prepare("SELECT subject FROM workspace_identity WHERE id='owner'").get();
  w.store.db.prepare("INSERT INTO workspace_identity VALUES('owner','google-sub','owner@candidate.com','Owner',?)").run(Date.now());
  // Clearing career data does not delete credentials or unlock public access.
  await w.store.replace(initialState(false));assert.equal(identity().subject,'google-sub');
  for(let i=0;i<20;i++)assert.equal((await w.request('/api/auth/password',{body:{password:'bad'}})).status,401);
  assert.equal((await w.request('/api/auth/password',{body:{password:'test-password'}})).status,429);
});

test('Google login verifies signed identity, PKCE, nonce, browser binding and exclusive owner without Gmail access',async t=>{
  const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk={...await exportJWK(publicKey),kid:'test-key',alg:'RS256',use:'sig'};
  let savedNonce,expectedVerifier,subject='owner-sub',emailVerified=true,audience='test-client.apps.googleusercontent.com',issuer='https://accounts.google.com';let tokenCalls=0;
  const w=await setup(t,{fetcher:async(url,options)=>{
    if(String(url).endsWith('/certs'))return new Response(JSON.stringify({keys:[jwk]}),{headers:{'Content-Type':'application/json'}});
    assert.equal(String(url),'https://oauth2.googleapis.com/token');tokenCalls++;
    const body=new URLSearchParams(options.body);assert.equal(body.get('code_verifier'),expectedVerifier);assert.match(body.get('redirect_uri'),/^http:\/\/127\.0\.0\.1:\d+\/api\/oauth\/google\/callback$/);
    const id_token=await new SignJWT({email:'owner@candidate.com',email_verified:emailVerified,name:'Owner',nonce:savedNonce}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setSubject(subject).setAudience(audience).setIssuer(issuer).setIssuedAt().setExpirationTime('5m').sign(privateKey);
    return new Response(JSON.stringify({id_token,access_token:'unused-for-login'}),{headers:{'Content-Type':'application/json'}});
  }});
  const first=await w.request('/api/auth/google/start');assert.match(first.headers.get('location'),/unlock_to_link/);assert.equal(w.store.db.prepare('SELECT count(*) AS n FROM oauth_states').get().n,0);
  const password=await unlock(w);
  async function start(session=password) {
    const r=await w.request('/api/auth/google/start',{cookie:session}),u=new URL(r.headers.get('location'));
    assert.equal(u.origin,'https://accounts.google.com');assert.equal(u.searchParams.get('scope'),'openid email profile');assert.equal(u.searchParams.get('access_type'),null);assert.equal(u.searchParams.get('code_challenge_method'),'S256');
    const state=u.searchParams.get('state'),encrypted=w.store.db.prepare('SELECT secret FROM oauth_states WHERE id=?').get(hash(state));
    const secrets=tokenCipher(w.options).open(encrypted.secret);expectedVerifier=secrets.verifier;savedNonce=u.searchParams.get('nonce');assert.equal(savedNonce,secrets.nonce);
    return {path:`/api/oauth/google/callback?state=${encodeURIComponent(state)}&code=test-code`,binding:r.headers.getSetCookie()[0].split(';')[0]};
  }
  const missingBrowser=await start();assert.match((await w.request(missingBrowser.path,{cookie:password})).headers.get('location'),/google_failed/);assert.equal(tokenCalls,0);
  const link=await start();const linked=await w.request(link.path,{cookie:`${password}; ${link.binding}`});assert.equal(linked.headers.get('location'),'/');assert.ok(cookie(linked));
  assert.equal(w.store.db.prepare('SELECT count(*) AS n FROM mail_accounts').get().n,0);
  assert.equal((await w.request('/api/auth/session',{cookie:cookie(linked)})).body.method,'google');
  assert.equal(w.store.db.prepare("SELECT subject FROM workspace_identity WHERE id='owner'").get().subject,'owner-sub');
  assert.match((await w.request(link.path,{cookie:`${password}; ${link.binding}`})).headers.get('location'),/google_failed/);
  // Thereafter Google sign-in works without the workspace password.
  const standalone=await start('');assert.ok(cookie(await w.request(standalone.path,{cookie:standalone.binding})));
  subject='unrelated-sub';const other=await start('');assert.match((await w.request(other.path,{cookie:other.binding})).headers.get('location'),/wrong_account/);
  subject='owner-sub';emailVerified=false;const unverified=await start('');assert.match((await w.request(unverified.path,{cookie:unverified.binding})).headers.get('location'),/google_failed/);
  emailVerified=true;audience='wrong-client';const wrongAudience=await start('');assert.match((await w.request(wrongAudience.path,{cookie:wrongAudience.binding})).headers.get('location'),/google_failed/);
  audience=w.options.GOOGLE_CLIENT_ID;issuer='https://attacker.invalid';const wrongIssuer=await start('');assert.match((await w.request(wrongIssuer.path,{cookie:wrongIssuer.binding})).headers.get('location'),/google_failed/);
});

test('password rotation invalidates persisted sessions and signed workspace checks return counts only',async t=>{
  const store=openStore(':memory:');t.after(()=>store.close());
  const a=await setup(t,{store,config:{AUTOPILOT_CRON_SECRET:'test-cron'}}),token=await unlock(a);
  const b=await setup(t,{store,config:{WORKSPACE_PASSWORD:'rotated'}});
  assert.equal((await b.request('/api/bootstrap',{cookie:token})).status,401);
  assert.equal((await a.request('/api/internal/workspace-check',{body:{}})).status,401);
  const check=await a.request('/api/internal/workspace-check',{body:{},headers:{'X-Orbit-Scheduler':'test-cron'}});
  assert.equal(check.status,200);assert.equal(check.body.ok,true);assert.deepEqual(Object.keys(check.body).sort(),['career','contactDiscovery','features','googleConfigured','indexed','mail','matches','ok','storage']);
  assert.equal(check.body.career.available,true);assert.equal(check.body.contactDiscovery.hunterConfigured,false);assert.deepEqual(check.body.mail,{connectedAccounts:0,liveSending:false});
});
