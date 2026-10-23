import {providerJSON} from './provider-http.mjs';
import {normalizeProviderContact} from './normalized.mjs';
import {providerKey} from '../../services/provider-config.mjs';
import {cleanHunterDomain} from './hunter.mjs';
import {fail} from '../../domain.mjs';
// v2 replaces the retired public/v1 query-string-key endpoint. This request
// runs only in a worker: the documented finder can take more than a minute.
export async function findGetProspectEmail(person,domain,key,fetcher=fetch) {
  key=providerKey(key,'getprospect');domain=cleanHunterDomain(domain);if(!key || !domain)fail('Configure GetProspect and use a corporate domain.',503);
  const result=await providerJSON('GetProspect','https://api.getprospect.com/v2/email/find',{method:'POST',headers:{'x-api-key':key,'Content-Type':'application/json'},body:JSON.stringify({data:{full_name:person.name || person.full_name,domain}})},fetcher,95000,[key]);
  const data=result.data;if(!result.success || !data?.email)return null;
  return normalizeProviderContact({...person,email:data.email},domain,'GetProspect',{verified:data.status==='valid',catchAll:data.domain_status==='accept_all',reference:person.linkedinUrl || 'https://getprospect.com/'});
}
