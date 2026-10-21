import {remoteJSON} from '../http.mjs';
import {fail} from '../../domain.mjs';

export async function mailFailure(response,provider='Mailbox') {
  let reason='';
  try {
    const reader=response.body?.getReader();let size=0;const chunks=[];
    if(reader)while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>32000){await reader.cancel();break;}chunks.push(part.value);}
    const data=JSON.parse(Buffer.concat(chunks).toString());
    const values=[data.error, data.error?.status, data.error?.code,...(data.error?.errors || []).map(e=>e.reason),...(data.error?.details || []).map(e=>e.reason)].filter(v=>typeof v==='string');
    reason=values.find(v=>['invalid_grant','invalid_client','accessNotConfigured','SERVICE_DISABLED','insufficientPermissions','ACCESS_TOKEN_SCOPE_INSUFFICIENT','authError','InvalidAuthenticationToken','Authorization_RequestDenied','ErrorAccessDenied','rateLimitExceeded','userRateLimitExceeded','RESOURCE_EXHAUSTED'].includes(v)) || '';
  }catch{}
  const action=reason==='invalid_grant' || response.status===401 ? 'The grant expired or was revoked. Reconnect this mailbox in Connections.'
    : ['accessNotConfigured','SERVICE_DISABLED'].includes(reason) ? 'Enable the Gmail API in the Google Cloud project used by this OAuth client, then reconnect.'
    : ['insufficientPermissions','ACCESS_TOKEN_SCOPE_INSUFFICIENT','ErrorAccessDenied','Authorization_RequestDenied'].includes(reason) ? 'Required mailbox scopes were not granted. Reconnect with inbox and send access; Microsoft may require administrator consent.'
    : response.status===403 ? 'Check that the Gmail API is enabled and the OAuth account has inbox/send permission. Reconnect the mailbox after changing permissions.'
    : response.status===429 ? 'Provider rate limit reached. Try again later; queued emails retain their pacing.'
    : response.status===400 ? 'The provider rejected this request. Check the OAuth client, callback URL and mailbox grant.'
    : 'The mailbox provider is temporarily unavailable.';
  return Object.assign(Error(`${provider} HTTP ${response.status}${reason ? ` (${reason})` : ''}. ${action}`),{status:502,providerStatus:response.status,providerReason:reason});
}
export async function mailJSON(url,options={},fetcher=fetch,timeout=15000) {
  let response;try{response=await fetcher(url,{...options,signal:AbortSignal.timeout(timeout),redirect:'error',headers:{Accept:'application/json',...options.headers}});}catch{fail('Mailbox provider could not be reached. Retry the connection check later.',502);}
  if(!response.ok)throw await mailFailure(response,String(url).includes('google') ? 'Google' : 'Microsoft');
  return remoteJSON(url,{},async()=>response,timeout);
}
