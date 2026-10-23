import {PROVIDERS,effectiveProviderConfig} from './provider-config.mjs';
import {providerJSON} from '../providers/contacts/provider-http.mjs';
import {serperSearch} from '../providers/contacts/serper-xray.mjs';
import {searchMineleadDomain} from '../providers/contacts/minelead.mjs';
import {now,fail} from '../domain.mjs';
const number=value=>Number.isFinite(Number(value)) && value!==null && value!==undefined?Number(value):null;
export async function verifyProvider(provider,store,base={},fetcher=fetch,{confirmMetered=false}={}) {
  const p=PROVIDERS.find(p=>p.id===provider);if(!p)fail('Choose a supported provider.');
  const config=await effectiveProviderConfig(store,base),key=config[p.env];if(!key)fail(`Save a ${p.name} key first.`,503);
  if(p.meteredCheck && !confirmMetered)fail('This check uses one provider search request. Confirm the usage first.');
  const previous=store.state.contactProviderChecks?.checks.find(c=>c.provider===p.name);
  if(previous && Date.now()-Date.parse(previous.checkedAt || '')<60000)return {...previous,cached:true};
  const request=(url,options={})=>providerJSON(p.name,url,options,fetcher,10000,[key]);
  let result;
  try {
    let usage=null,message='Key accepted.',creditsUsed=0;
    if(provider==='hunter') {
      const url=new URL('https://api.hunter.io/v2/account');url.searchParams.set('api_key',key);const data=(await request(url.href)).data;
      if(!data?.requests)fail('Hunter returned no account usage data.',502);
      usage=Object.fromEntries(['searches','verifications'].map(type=>{const bucket=data.requests[type] || {},total=number(bucket.available),used=number(bucket.used);return [type,{total,used,remaining:total===null || used===null?null:Math.max(0,total-used)}];}));
    }else if(provider==='prospeo') {
      const data=await request('https://api.prospeo.io/account-information',{headers:{'X-KEY':key}}),stats=data.response || {};
      usage={credits:{remaining:number(stats.remaining_credits),used:number(stats.used_credits),renewsAt:stats.next_quota_renewal_date || null}};
    }else if(provider==='getprospect') {
      const data=await request('https://api.getprospect.com/v2/credits',{headers:{'x-api-key':key}});
      usage=Object.fromEntries(Object.entries(data.data || {}).map(([type,value])=>[type,{remaining:number(value.available),total:number(value.limit || value.total)}]));
    }else if(provider==='tavily') {
      const data=await request('https://api.tavily.com/usage',{headers:{Authorization:`Bearer ${key}`}}),stats=data.key || {};
      usage={searches:{total:number(stats.limit),used:number(stats.usage),remaining:number(stats.limit)===null || number(stats.usage)===null?null:Math.max(0,Number(stats.limit)-Number(stats.usage))}};
    }else if(provider==='serper') {
      const data=await serperSearch('site:linkedin.com/in "Technical Recruiter" "Microsoft"',key,{fetcher,limit:1});creditsUsed=data.creditsUsed;message='Targeted people-search query accepted. Account balance is available in your Serper dashboard.';
    }else if(provider==='minelead') {
      await searchMineleadDomain('minelead.io',key,1,fetcher);creditsUsed=null;message='Search endpoint accepted this key. Check your dashboard for its current credit balance.';
    }else if(provider==='gemini') {
      await request(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.LLM_MODEL || 'gemini-flash-latest')}`,{headers:{'x-goog-api-key':key}});message='Key and configured model accepted. No generation was requested.';
    }else {message='Use the existing Apollo connection check for endpoint access.';}
    result={provider:p.name,configured:true,ok:true,message,usage,creditsUsed,checkedAt:now()};
  }catch(error){const restricted=provider==='serper' && /query pattern not allowed for free accounts/i.test(error.message);result={provider:p.name,configured:true,ok:false,httpStatus:error.providerStatus || null,capabilityRestricted:restricted,message:restricted?`${error.message} This account cannot run the targeted people/ATS queries used here. Use a search provider or plan with that capability; public sources remain available.`:error.status?error.message:`${p.name} could not be reached.`,checkedAt:now()};}
  await store.refresh();const previousChecks=store.state.contactProviderChecks?.checks || [];
  store.state.contactProviderChecks={checkedAt:now(),checks:[...previousChecks.filter(c=>c.provider!==p.name),result]};await store.save();return result;
}
