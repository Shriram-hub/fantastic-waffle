import {Resolver} from 'node:dns/promises';
import {remoteJSON} from '../http.mjs';

export function mailGateway(records=[]) {
  const hosts=records.map(r=>r.exchange || '').join(' ').toLowerCase();
  return /google\.com|googlemail\.com/.test(hosts) ? 'Google Workspace' : /mail\.protection\.outlook\.com/.test(hosts) ? 'Microsoft 365' : /zoho\./.test(hosts) ? 'Zoho' : /mimecast|pphosted|proofpoint/.test(hosts) ? 'Enterprise gateway' : records.length ? 'Other mail gateway' : 'Unknown';
}
export async function dohRecords(domain,type,fetcher=fetch) {
  const url=new URL('https://dns.google/resolve');
  url.search=new URLSearchParams({name:domain,type,edns_client_subnet:'0.0.0.0/0'});
  const data=await remoteJSON(url.href,{},fetcher,3000);
  if(data.Status===3)return {status:'not-found',records:[]};
  if(data.Status!==0 || data.TC)throw Error('DNS temporarily unavailable');
  const records=(data.Answer || []).filter(r=>r.type===(type==='MX' ? 15 : 16)).map(r=>type==='MX' ? {priority:Number(String(r.data).split(/\s+/)[0]),exchange:String(r.data).split(/\s+/).slice(1).join(' ').replace(/\.$/,'') || '.'} : String(r.data));
  return {status:'ok',records};
}
// HTTPS fallback works on hosts which restrict outbound DNS. No SMTP sockets or
// recipient probes: MX/SPF establish domain health, never mailbox existence.
export async function domainMailHealth(domain,{lookupMx,fetcher=fetch,includeTXT=false}={}) {
  let records,provider='DNS',negative=false;
  try {
    const resolver=new Resolver({timeout:3000,tries:1});
    let timer;
    try {records=await Promise.race([(lookupMx || (name=>resolver.resolveMx(name)))(domain),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('DNS timeout'),{code:'ETIMEOUT'})),3000);})]);}
    finally {clearTimeout(timer);resolver.cancel();}
  } catch(error) {
    negative=error.code==='ENOTFOUND';
    try {const result=await dohRecords(domain,'MX',fetcher);records=result.records;negative=result.status==='not-found';provider='DNS over HTTPS';}catch{}
  }
  const nullMX=records?.length && records.every(r=>!r.exchange || r.exchange==='.'),hasMx=!!records?.some(r=>r.exchange && r.exchange!=='.');
  let spf=null;
  if(includeTXT && hasMx)try{spf=(await dohRecords(domain,'TXT',fetcher)).records.some(r=>/v=spf1/i.test(r));}catch{}
  return {domain,status:nullMX || negative ? 'invalid' : hasMx ? 'mx-found' : 'unknown',hasMx,gateway:mailGateway(records),provider,spf,reason:nullMX ? 'Domain explicitly rejects email (null MX)' : negative ? 'Domain does not exist' : hasMx ? 'Mail gateway found; recipient mailbox is unverified' : 'Domain mail routing could not be confirmed'};
}
