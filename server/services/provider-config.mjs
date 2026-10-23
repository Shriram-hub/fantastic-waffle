import {AsyncLocalStorage} from 'node:async_hooks';
import {tokenCipher} from '../providers/mail/oauth.mjs';
import {fail,now} from '../domain.mjs';

export const PROVIDERS=[
  {id:'hunter',name:'Hunter',env:'HUNTER_API_KEY',field:'hunterApiKey',purpose:'Company emails and mailbox verification'},
  {id:'serper',name:'Serper',env:'SERPER_API_KEY',field:'serperApiKey',purpose:'Google people and career-board search',meteredCheck:true},
  {id:'tavily',name:'Tavily',env:'TAVILY_API_KEY',field:'tavilyApiKey',purpose:'Web and people search'},
  {id:'prospeo',name:'Prospeo',env:'PROSPEO_API_KEY',field:'prospeoApiKey',purpose:'Business email search and enrichment'},
  {id:'getprospect',name:'GetProspect',env:'GETPROSPECT_API_KEY',field:'getprospectApiKey',purpose:'Named business email finder'},
  {id:'minelead',name:'Minelead',env:'MINELEAD_API_KEY',field:'mineleadApiKey',purpose:'Company email search',meteredCheck:true},
  {id:'gemini',name:'Gemini',env:'LLM_API_KEY',field:'geminiApiKey',purpose:'Resume extraction and document drafting'},
  {id:'apollo',name:'Apollo',env:'APOLLO_API_KEY',field:'apolloApiKey',purpose:'Optional people search'},
];
const context=new AsyncLocalStorage();
export function providerConfigView(input) {
  const base={...Object.fromEntries(PROVIDERS.map(p=>[p.env,''])),...input};
  return new Proxy(base,{get:(target,key)=>(context.getStore() || target)[key]});
}
export const withProviderConfig=(config,fn)=>context.run(config,fn);
export function providerKey(value,provider) {
  const p=PROVIDERS.find(p=>p.id===provider);if(!p)return '';
  return String(typeof value==='string' ? value : value?.connections?.[p.field] || value?.settings?.[p.field] || value?.[p.field] || value?.[p.env] || '').trim();
}
export function publicProviderState(state) {
  const clean=value=>Object.fromEntries(Object.entries(value || {}).filter(([key])=>!PROVIDERS.some(p=>key===p.field || key===p.env) && !/api.?key|secret|token/i.test(key)));
  return {...state,connections:undefined,settings:clean(state.settings)};
}
export async function effectiveProviderConfig(store,base={}) {
  const result={...base};
  const rows=await store.db.prepare('SELECT id,secret FROM provider_credentials').all();
  let migrated=false;
  for(const p of PROVIDERS) {
    const legacy=providerKey({connections:store.state.connections,settings:store.state.settings},p.id);
    const row=rows.find(r=>r.id===p.id);
    result[p.env]=row ? String(tokenCipher(base).open(row.secret).key || '').trim() : legacy || providerKey(base,p.id);
    if(legacy && base.TOKEN_ENCRYPTION_KEY){if(!row)await store.db.prepare('INSERT INTO provider_credentials(id,secret,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING').run(p.id,tokenCipher(base).seal({key:legacy}),Date.now());for(const group of [store.state.connections,store.state.settings])if(group){delete group[p.field];delete group[p.env];}migrated=true;}
    if(p.id==='gemini' && (row || legacy))result.LLM_PROVIDER='gemini';
  }
  if(migrated)await store.save();
  return result;
}
export async function saveProviderKey(provider,key,store,config={}) {
  const p=PROVIDERS.find(p=>p.id===provider);if(!p)fail('Choose a supported provider.');
  if(typeof key!=='string' || !key.trim() || key.trim().length>1024 || /[\r\n\0]/.test(key.trim()))fail('Enter a valid API key.');
  const secret=tokenCipher(config).seal({key:key.trim()});
  await store.db.prepare('INSERT INTO provider_credentials(id,secret,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET secret=excluded.secret,updated_at=excluded.updated_at').run(p.id,secret,Date.now());
  for(const group of [store.state.connections,store.state.settings])if(group){delete group[p.field];delete group[p.env];}
  if(store.state.contactProviderChecks)store.state.contactProviderChecks.checks=store.state.contactProviderChecks.checks.filter(c=>c.provider!==p.name);
  await store.save();return {provider:p.id,configured:true,savedAt:now()};
}
export async function providerSummaries(store,base={}) {
  const config=await effectiveProviderConfig(store,base),rows=await store.db.prepare('SELECT id,updated_at FROM provider_credentials').all();
  return PROVIDERS.map(p=>({id:p.id,name:p.name,purpose:p.purpose,configured:!!config[p.env],source:rows.some(r=>r.id===p.id)?'workspace':config[p.env]?'server':'none',updatedAt:rows.find(r=>r.id===p.id)?.updated_at || null,meteredCheck:!!p.meteredCheck}));
}
