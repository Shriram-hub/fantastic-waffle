import {createHmac,timingSafeEqual} from 'node:crypto';
import {fail,text} from '../domain.mjs';
import {companyDomain} from '../providers/contacts/company.mjs';
const key=config=>config.TOKEN_ENCRYPTION_KEY || config.WORKSPACE_PASSWORD;
export function linkedinLaunch(data,config={}) {
  const company=text(data.company,150).trim(),role=text(data.role,120).trim(),domain=companyDomain(data.domain),count=Math.min(100,Math.max(1,Number(data.targetCount)||50));
  if(company.length<2)fail('Enter a company before opening LinkedIn.');if(!key(config))fail('Configure the workspace encryption key before automatic LinkedIn launches.',503);
  const body=Buffer.from(JSON.stringify({company,role,domain,count,expires:Date.now()+300000})).toString('base64url'),signature=createHmac('sha256',key(config)).update(`linkedin-harvest:${body}`).digest('base64url'),intent=`${body}.${signature}`;
  const url=new URL('https://www.linkedin.com/search/results/people/');url.searchParams.set('keywords',[company,role].filter(Boolean).join(' '));url.hash=new URLSearchParams({veloce_harvest:String(count),company,domain,veloce_intent:intent}).toString();return {url:url.href};
}
export function readLinkedinIntent(intent,sourceUrl,config={}) {
  const [body,signature,extra]=String(intent || '').split('.');if(!body || !/^[A-Za-z0-9_-]{43}$/.test(signature || '') || extra || body.length>2000 || !key(config))fail('Open a fresh LinkedIn harvest from Veloce.',400);
  const expected=createHmac('sha256',key(config)).update(`linkedin-harvest:${body}`).digest('base64url');if(expected.length!==signature.length || !timingSafeEqual(Buffer.from(expected),Buffer.from(signature)))fail('This LinkedIn harvest link is invalid.',400);
  let data,u;try{data=JSON.parse(Buffer.from(body,'base64url').toString());u=new URL(sourceUrl);}catch{fail('Invalid LinkedIn harvest link.');}
  if(data.expires<Date.now() || data.expires>Date.now()+300000 || u.protocol!=='https:' || !/(^|\.)linkedin\.com$/.test(u.hostname) || !u.pathname.startsWith('/search/results/people') || u.searchParams.get('keywords')!==[data.company,data.role].filter(Boolean).join(' '))fail('This LinkedIn harvest expired or points to a different search. Open it again from Veloce.');
  return data;
}
