import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {createRemoteJWKSet,jwtVerify,customFetch} from 'jose';
import {hash,fail} from './domain.mjs';
import {tokenCipher,oauthConfig} from './providers/mail/oauth.mjs';
import {remoteJSON} from './providers/http.mjs';

const SESSION_SECONDS=7*86400,STATE_SECONDS=600;
const random=()=>randomBytes(32).toString('base64url');
const equal=(a,b)=>{const x=Buffer.from(String(a || '')),y=Buffer.from(String(b || ''));return x.length===y.length && timingSafeEqual(x,y);};
const cookies=req=>Object.fromEntries(String(req.headers.cookie || '').split(';').map(v=>{const i=v.indexOf('=');return [v.slice(0,i).trim(),v.slice(i+1).trim()];}).filter(([k])=>k));
export const passwordValid=(value,config)=>!!config.WORKSPACE_PASSWORD && equal(value,config.WORKSPACE_PASSWORD);
export function basicAuthenticated(req,config) {
  // Keep explicit API clients compatible without resurrecting a logged-out
  // browser session from an old cached HTTP Basic credential.
  if('sec-fetch-dest' in req.headers)return false;
  if(!req.headers.authorization?.startsWith('Basic '))return false;
  try {const decoded=Buffer.from(req.headers.authorization.slice(6),'base64').toString('utf8');return decoded.includes(':') && passwordValid(decoded.slice(decoded.indexOf(':')+1),config);}catch{return false;}
}
export function sameOrigin(req) {
  if(req.headers['sec-fetch-site']==='cross-site')fail('Cross-site writes are blocked.',403);
  if(req.headers.origin && new URL(req.headers.origin).host!==req.headers.host)fail('Cross-origin writes are blocked.',403);
}
export function workspaceAuth(store,config,fetcher=fetch) {
  const secure=new URL(config.PUBLIC_BASE_URL || config.RENDER_EXTERNAL_URL || 'http://localhost').protocol==='https:';
  const sessionName=secure ? '__Host-orbit_session' : 'orbit_session',stateName=secure ? '__Host-orbit_oauth' : 'orbit_oauth';
  const cookie=(name,value,seconds)=>`${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure ? '; Secure' : ''}`;
  const googleConfigured=!!(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET && config.TOKEN_ENCRYPTION_KEY);
  const required=!!config.WORKSPACE_PASSWORD;
  const googleKeys=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'),{[customFetch]:fetcher});
  const owner=()=>store.db.prepare("SELECT * FROM workspace_identity WHERE id='owner'").get();
  async function session(req) {
    const token=cookies(req)[sessionName];if(!/^[a-zA-Z0-9_-]{43}$/.test(token || ''))return null;
    const row=await store.db.prepare('SELECT body,expires FROM auth_sessions WHERE id=?').get(hash(token));
    if(!row || row.expires<Date.now())return null;
    const value=JSON.parse(row.body);
    // Rotating the workspace password also revokes all old sessions.
    if(!equal(value.credentialVersion,hash(config.WORKSPACE_PASSWORD)))return null;
    if(value.method==='google') {const identity=await owner();if(!identity || identity.subject!==value.subject)return null;}
    return value;
  }
  async function createSession(res,identity) {
    const token=random();
    await store.db.prepare('DELETE FROM auth_sessions WHERE expires<?').run(Date.now());
    await store.db.prepare('INSERT INTO auth_sessions(id,body,expires) VALUES(?,?,?)').run(hash(token),JSON.stringify({...identity,credentialVersion:hash(config.WORKSPACE_PASSWORD)}),Date.now()+SESSION_SECONDS*1000);
    res.setHeader('Set-Cookie',cookie(sessionName,token,SESSION_SECONDS));
  }
  const redirect=(res,path)=>{res.writeHead(303,{Location:path});res.end();return true;};
  async function handle(req,res,url,{json,bodyJSON}) {
    const path=url.pathname;
    if(req.method==='GET' && path==='/api/auth/session') {
      const current=await session(req),identity=await owner();
      json(res,200,{required,authenticated:!required || !!current,method:current?.method || (!required ? 'local' : null),user:current?.method==='google' ? {email:current.email,name:current.name} : null,googleConfigured,googleLinked:!!identity,passwordEnabled:required});return true;
    }
    if(req.method==='POST' && path==='/api/auth/password') {
      sameOrigin(req);
      const data=await bodyJSON(req),at=Date.now();
      // A durable per-workspace budget also covers service restarts and proxy IPs.
      await store.db.prepare("INSERT INTO auth_rate_limits(id,attempts,reset_at) VALUES('password',1,?) ON CONFLICT(id) DO UPDATE SET attempts=CASE WHEN auth_rate_limits.reset_at<? THEN 1 ELSE auth_rate_limits.attempts+1 END,reset_at=CASE WHEN auth_rate_limits.reset_at<? THEN excluded.reset_at ELSE auth_rate_limits.reset_at END").run(at+15*60000,at,at);
      const attempts=await store.db.prepare("SELECT attempts FROM auth_rate_limits WHERE id='password'").get();
      if(attempts.attempts>20) {res.setHeader('Retry-After','900');fail('Too many sign-in attempts. Try again in 15 minutes.',429);}
      if(!passwordValid(data.password,config))fail('That workspace password is incorrect.',401);
      await store.db.prepare("DELETE FROM auth_rate_limits WHERE id='password'").run();
      const old=cookies(req)[sessionName];if(old)await store.db.prepare('DELETE FROM auth_sessions WHERE id=?').run(hash(old));
      await createSession(res,{method:'password'});json(res,200,{ok:true});return true;
    }
    if(req.method==='POST' && path==='/api/auth/logout') {
      sameOrigin(req);const token=cookies(req)[sessionName];if(token)await store.db.prepare('DELETE FROM auth_sessions WHERE id=?').run(hash(token));
      res.setHeader('Set-Cookie',[cookie(sessionName,'',0),cookie(stateName,'',0)]);json(res,200,{ok:true});return true;
    }
    if(req.method==='GET' && path==='/api/auth/google/start') {
      if(!googleConfigured) return redirect(res,'/?auth_error=google_configuration');
      const identity=await owner(),current=await session(req);
      if(!identity && current?.method!=='password')return redirect(res,'/?auth_error=unlock_to_link');
      // Only the password-authenticated owner can bind the first Google identity.
      const state=`signin.${random()}`,binding=random(),verifier=random(),nonce=random(),options=oauthConfig('google',config);
      await store.db.prepare('DELETE FROM oauth_states WHERE expires<?').run(Date.now());
      await store.db.prepare('INSERT INTO oauth_states(id,secret,expires) VALUES(?,?,?)').run(hash(state),tokenCipher(config).seal({purpose:'signin',binding:hash(binding),verifier,nonce,canLink:!identity && current?.method==='password',linkSession:!identity ? hash(cookies(req)[sessionName]) : null}),Date.now()+STATE_SECONDS*1000);
      const target=new URL(options.auth);target.search=new URLSearchParams({client_id:options.clientId,redirect_uri:options.redirect,response_type:'code',scope:'openid email profile',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',prompt:'select_account'});
      res.setHeader('Set-Cookie',cookie(stateName,binding,STATE_SECONDS));return redirect(res,target.href);
    }
    // Reuse the mailbox callback URI already registered in Google Cloud. The
    // encrypted, browser-bound state purpose keeps login and Gmail grants apart.
    if(req.method==='GET' && path==='/api/oauth/google/callback' && url.searchParams.get('state')?.startsWith('signin.')) {
      res.setHeader('Set-Cookie',cookie(stateName,'',0));
      try {
        const state=url.searchParams.get('state'),row=await store.db.prepare('SELECT * FROM oauth_states WHERE id=?').get(hash(state));
        if(!row || row.expires<Date.now())fail('Expired sign-in.',403);
        const saved=tokenCipher(config).open(row.secret);
        if(saved.purpose!=='signin' || !equal(saved.binding,hash(cookies(req)[stateName] || '')))fail('Browser state mismatch.',403);
        const consumed=await store.db.prepare('DELETE FROM oauth_states WHERE id=?').run(row.id);
        if(!consumed.changes)fail('Sign-in already used.',403);
        if(url.searchParams.has('error'))return redirect(res,'/?auth_error=google_denied');
        const code=url.searchParams.get('code');if(!code || code.length>4096)fail('Missing authorization code.',403);
        const options=oauthConfig('google',config);
        const tokens=await remoteJSON(options.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:options.clientId,client_secret:options.clientSecret,redirect_uri:options.redirect,grant_type:'authorization_code',code,code_verifier:saved.verifier}).toString()},fetcher);
        const {payload}=await jwtVerify(tokens.id_token,googleKeys,{issuer:['https://accounts.google.com','accounts.google.com'],audience:options.clientId,algorithms:['RS256'],requiredClaims:['sub','iat','exp','nonce','email','email_verified'],maxTokenAge:'10m',clockTolerance:30});
        if(payload.nonce!==saved.nonce || payload.email_verified!==true || typeof payload.sub!=='string' || typeof payload.email!=='string' || payload.azp && payload.azp!==options.clientId)fail('Invalid Google identity.',403);
        let identity=await owner();
        if(!identity) {
          const current=await session(req);
          if(!saved.canLink || current?.method!=='password' || saved.linkSession!==hash(cookies(req)[sessionName]))fail('Unlock the workspace before linking Google.',403);
          await store.db.prepare("INSERT OR IGNORE INTO workspace_identity(id,subject,email,name,created_at) VALUES('owner',?,?,?,?)").run(payload.sub,payload.email.toLowerCase(),String(payload.name || '').slice(0,150),Date.now());
          identity=await owner();
        }
        if(identity.subject!==payload.sub)return redirect(res,'/?auth_error=wrong_account');
        const old=cookies(req)[sessionName];if(old)await store.db.prepare('DELETE FROM auth_sessions WHERE id=?').run(hash(old));
        await createSession(res,{method:'google',subject:payload.sub,email:payload.email,name:String(payload.name || '').slice(0,150)});
        // Both cookies must survive: remove the one-time binding and set a new session.
        res.setHeader('Set-Cookie',[res.getHeader('Set-Cookie'),cookie(stateName,'',0)]);
        return redirect(res,'/');
      } catch(error) {
        // Never put authorization codes, tokens, identity claims or provider text in URLs/logs.
        return redirect(res,`/?auth_error=${error.status===502 ? 'google_unavailable' : 'google_failed'}`);
      }
    }
    return false;
  }
  return {handle,session,required,async authenticated(req){return !required || !!(await session(req)) || basicAuthenticated(req,config);}};
}
