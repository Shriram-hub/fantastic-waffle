import {withDeadline,boundedFetcher} from '../providers/deadline.mjs';
// Accept provider-hosted raster assets only; never proxy arbitrary employer URLs.
export function providerLogoURL(value) {
  try{const u=new URL(value);return u.protocol==='https:' && !u.port && !u.username && !u.password && ['remotive.com','www.remotive.com','jobicy.com','www.jobicy.com'].includes(u.hostname) ? u.href : '';}catch{return '';}
}
export function companyLogos(fetcher=fetch) {
  const cache=new Map();
  return async job=>{
    const url=providerLogoURL(job.companyLogo);if(!url)return null;
    const cached=cache.get(url);if(cached && cached.expires>Date.now())return cached.value;
    const value=withDeadline(async signal=>{
      const response=await boundedFetcher(fetcher,signal)(url,{redirect:'error',headers:{Accept:'image/png,image/jpeg,image/webp'}});
      if(!response.ok)return null;
      const reader=response.body?.getReader();if(!reader)return null;const chunks=[];let size=0;
      try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>200000){await reader.cancel();return null;}chunks.push(chunk.value);}}finally{reader.releaseLock();}
      const bytes=Buffer.concat(chunks),type=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' : bytes[0]===255 && bytes[1]===216 && bytes[2]===255 ? 'image/jpeg' : bytes.subarray(0,4).toString()==='RIFF' && bytes.subarray(8,12).toString()==='WEBP' ? 'image/webp' : null;
      return type ? {bytes,type} : null;
    },2000).catch(()=>null);
    cache.set(url,{value,expires:Date.now()+3600000});if(cache.size>128)cache.delete(cache.keys().next().value);return value;
  };
}
