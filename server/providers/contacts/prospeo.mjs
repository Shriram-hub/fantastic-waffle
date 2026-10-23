import {providerJSON} from './provider-http.mjs';
import {normalizeProviderContact} from './normalized.mjs';
import {providerKey} from '../../services/provider-config.mjs';
import {cleanHunterDomain} from './hunter.mjs';
import {fail} from '../../domain.mjs';
const request=(path,body,key,fetcher)=>providerJSON('Prospeo',`https://api.prospeo.io/${path}`,{method:'POST',headers:{'X-KEY':key,'Content-Type':'application/json'},body:JSON.stringify(body)},fetcher,20000,[key]);
export async function findProspeoEmail(person,domain,key,fetcher=fetch) {
  key=providerKey(key,'prospeo');domain=cleanHunterDomain(domain);if(!key || !domain)fail('Configure Prospeo and use a corporate domain.',503);
  const result=await request('enrich-person',{only_verified_email:true,enrich_mobile:false,data:person.person_id?{person_id:person.person_id}:{full_name:person.name || person.full_name,company_website:domain}},key,fetcher);
  const p=result.person || result.results?.[0]?.person;if(!p?.email?.revealed)return null;
  return normalizeProviderContact({...p,email:p.email.email},domain,'Prospeo',{verified:p.email.status==='VERIFIED',reference:person.linkedinUrl || p.linkedin_url || 'https://prospeo.io/'});
}
export async function searchProspeoDomain(domain,key,limit=15,fetcher=fetch,{reveal=false,call}={}) {
  key=providerKey(key,'prospeo');domain=cleanHunterDomain(domain);if(!key || !domain)fail('Configure Prospeo and use a corporate domain.',503);
  const data=await request('search-person',{page:1,filters:{company:{websites:{include:[domain]}}}},key,fetcher);
  const people=(data.results || []).slice(0,Math.min(25,limit)).map(r=>({person_id:r.person?.person_id,name:r.person?.full_name,title:r.person?.current_job_title,linkedinUrl:r.person?.linkedin_url,companyDomain:domain,email:'',emailStatus:'unverified',source:'Prospeo people search'})).filter(p=>p.name);
  const contacts=[];
  for(const p of people) {
    const found=reveal && call ? await call(`person:${p.person_id}`,()=>findProspeoEmail(p,domain,key,fetcher)).catch(()=>null) : null;
    contacts.push(found || p);
  }
  return {contacts};
}
