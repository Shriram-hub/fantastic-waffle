import {now} from '../domain.mjs';
import {searchApollo} from '../providers/contacts/apollo.mjs';
import {remoteJSON} from '../providers/http.mjs';
import {contactProviderError} from '../providers/contacts/errors.mjs';

// Read-only checks: Apollo documents People API Search as zero-credit, and
// Hunter Account Stats is free. No contact is saved and no email is sent.
export async function checkContactProviders(store,config={},fetcher=fetch) {
  const cached=store.state.contactProviderChecks;
  if(cached && Date.now()-Date.parse(cached.checkedAt)<60000)return cached;
  const checkedAt=now();
  const check=async(provider,key,operation)=>{
    if(!key)return {provider,configured:false,ok:false,message:'Server key not configured.'};
    try{await operation();return {provider,configured:true,ok:true,message:provider==='Apollo' ? 'People Search endpoint accepted this key.' : 'Hunter accepted this key. Search and verification remain subject to plan credits.'};}
    catch(error){return {provider,configured:true,ok:false,httpStatus:error.providerStatus || null,message:error.status ? error.message : `${provider} could not be reached.`};}
  };
  const checks=await Promise.all([
    check('Apollo',config.APOLLO_API_KEY,()=>searchApollo({domain:'stripe.com',titles:'Recruiter',limit:1},config.APOLLO_API_KEY,fetcher)),
    check('Hunter',config.HUNTER_API_KEY,async()=>{const url=new URL('https://api.hunter.io/v2/account-stats');url.searchParams.set('api_key',config.HUNTER_API_KEY);try{const result=await remoteJSON(url.href,{},fetcher);if(!result.data)throw Object.assign(Error('Hunter returned an unexpected account-check response.'),{status:502});}catch(error){throw contactProviderError('Hunter',error);}}),
  ]);
  await store.refresh();store.state.contactProviderChecks={checkedAt,checks};await store.save();return store.state.contactProviderChecks;
}
