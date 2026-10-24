import {fail,text} from '../../domain.mjs';
export async function providerJSON(provider,url,options={},fetcher=fetch,timeout=10000,secrets=[]) {
  let response;
  try{response=await fetcher(url,{...options,redirect:'error',signal:options.signal ? AbortSignal.any([options.signal,AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),headers:{Accept:'application/json',...options.headers}});}catch{fail(`${provider} could not be reached before its deadline.`,502);}
  let raw;
  if(response.body?.getReader){const reader=response.body.getReader(),parts=[];let bytes=0;try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>1500000){await reader.cancel();fail(`${provider} returned too much data.`,502);}parts.push(part.value);}raw=Buffer.concat(parts).toString('utf8');}finally{reader.releaseLock();}}
  else {raw=await response.text();if(raw.length>1500000)fail(`${provider} returned too much data.`,502);}
  let data;try{data=JSON.parse(raw);}catch{fail(`${provider} returned an unreadable response (HTTP ${response.status}).`,502);}
  if(!response.ok || data.error===true || data.success===false) {
    let message=text(data.errors?.[0]?.details || data.errors?.[0]?.message || data.error?.message || data.message || data.detail?.error || data.detail || data.error_code || (typeof data.error==='string'?data.error:'') || 'Request rejected.',300);
    for(const key of secrets.filter(Boolean))message=message.replaceAll(key,'[redacted]');
    throw Object.assign(Error(`${provider} HTTP ${response.status}: ${message}`),{status:502,providerStatus:response.status,provider});
  }
  return data;
}
