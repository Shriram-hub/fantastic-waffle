import {get} from 'node:https';
import {Resolver} from 'node:dns/promises';
import {isIP} from 'node:net';

export function publicIPv4(value) {
  if(isIP(value)!==4) return false;
  const [a,b]=value.split('.').map(Number);
  return !(a===0 || a===10 || a===127 || a>=224 || a===169 && b===254 || a===172 && b>=16 && b<=31 || a===192 && [0,168].includes(b) || a===100 && b>=64 && b<=127 || a===198 && [18,19,51].includes(b) || a===203 && b===0);
}
// Pin a validated public IPv4 address into the TLS request. DNS validation
// followed by an ordinary fetch would leave a DNS-rebinding window.
async function page(url,domain,redirects=0) {
  const u=new URL(url);
  if(u.protocol!=='https:' || u.port && u.port!=='443' || ![domain,`www.${domain}`].includes(u.hostname) || u.username || u.password) throw Error('Unsupported company URL');
  const resolver=new Resolver({timeout:3000,tries:1}),addresses=await resolver.resolve4(u.hostname);
  if(!addresses.length || !addresses.every(publicIPv4)) throw Error('Company address is not public');
  const result=await new Promise((resolve,reject)=>{
    const req=get(u,{lookup:(_host,options,callback)=>callback(null,options.all ? [{address:addresses[0],family:4}] : addresses[0],4),headers:{'User-Agent':'OrbitBot/0.5 (+job-search contact discovery)','Accept':'text/html,text/plain'},timeout:7000},res=>{
      if(res.statusCode>=300 && res.statusCode<400) {res.resume();resolve({redirect:res.headers.location});return;}
      if(res.statusCode!==200) {res.resume();reject(Error('Company page unavailable'));return;}
      if(!/text\/(html|plain)/i.test(res.headers['content-type'] || '')) {res.resume();reject(Error('Unsupported company content'));return;}
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>350000){req.destroy(Error('Company page too large'));return;}chunks.push(chunk);});
      res.on('end',()=>resolve({text:Buffer.concat(chunks).toString('utf8'),url:u.href}));res.on('error',reject);
    });
    req.on('timeout',()=>req.destroy(Error('Company page timed out')));req.on('error',reject);
  });
  if(result.redirect) {if(redirects>=2) throw Error('Too many company redirects');return page(new URL(result.redirect,u).href,domain,redirects+1);}
  return result;
}
export function robotsAllows(body,path) {
  let relevant=false;const rules=[];
  for(const line of body.split('\n')) {
    const match=line.split('#')[0].trim().match(/^(user-agent|disallow|allow)\s*:\s*(.*)$/i);if(!match) continue;
    const key=match[1].toLowerCase(),value=match[2].trim();
    if(key==='user-agent') relevant=value==='*' || /orbitbot/i.test(value);
    else if(relevant && value && path.startsWith(value)) rules.push({allow:key==='allow',length:value.length});
  }
  return rules.sort((a,b)=>b.length-a.length || Number(b.allow)-Number(a.allow))[0]?.allow ?? true;
}
export async function publicCompanyPages(domain) {
  let robots;
  try {robots=await page(`https://${domain}/robots.txt`,domain);} catch {return [];}
  const pages=[];
  for(const path of ['/careers','/jobs']) if(robotsAllows(robots.text,path)) {
    try {pages.push(await page(`https://${domain}${path}`,domain));} catch {}
  }
  return pages;
}
