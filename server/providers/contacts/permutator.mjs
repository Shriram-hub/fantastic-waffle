import {companyDomain} from './company.mjs';
const patterns=['{first}.{last}','{f}{last}','{first}_{last}','{first}','{first}{l}','{first}{last}','{first}-{last}'];
const letters=value=>String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z]/g,'');
const render=(pattern,f,l)=>pattern.replace(/\{(first|last|f|l)\}/g,(_,part)=>({first:f,last:l,f:f[0],l:l[0]})[part]);
// Observations establish a naming convention, never mailbox deliverability.
export function learnEmailPattern(contacts,domain,previous={}) {
  domain=companyDomain(domain);if(!domain)return null;
  const observations=new Map((previous.observations || []).map(o=>[o.email,o]));
  for(const c of contacts) {
    const email=String(c.email || '').toLowerCase(),parts=String(c.name || '').trim().split(/\s+/),f=letters(c.firstName || parts[0]),l=letters(c.lastName || parts.at(-1));
    const inferred=/pattern|permutation|suggested|guess/i.test(c.source || '') || c.emailInferred===true;
    if(inferred && c.emailStatus!=='verified' || !email.endsWith(`@${domain}`) || parts.length<2 && !c.lastName || !f || !l || /hiring|team|support|recruit|contact/i.test(c.name || '') || !c.sources?.some(s=>s.url) && !c.verification?.reference && !['verified','observed'].includes(c.emailStatus))continue;
    const matches=patterns.filter(p=>render(p,f,l)===email.split('@')[0]);if(!matches.length)continue;
    observations.set(email,{email,patterns:matches,name:c.name || `${c.firstName} ${c.lastName}`,reference:c.sources?.[0]?.url || c.verification?.reference || c.source,at:new Date().toISOString()});
  }
  const evidence=[...observations.values()].slice(-30),scores=patterns.map(pattern=>({pattern,count:evidence.filter(o=>o.patterns.includes(pattern)).length})).filter(s=>s.count).sort((a,b)=>b.count-a.count);
  if(!scores.length)return null;
  const best=scores[0],conflicting=evidence.some(o=>!o.patterns.includes(best.pattern)),ambiguous=scores[1]?.count===best.count;
  return {pattern:best.pattern,sampleCount:best.count,status:conflicting?'mixed':ambiguous?'ambiguous':best.count>=2?'corroborated':'observed',conflicting,observations:evidence,mailboxVerified:false,updatedAt:new Date().toISOString()};
}
export function permuteEmails({firstName,lastName,companyDomain:domain,domainPattern}) {
  domain=companyDomain(domain);
  const f=letters(firstName),l=letters(lastName);
  if(!domain || !f || !l) return [];
  const pattern=/^(?:[._-]|\{(?:first|last|f|l)\})+$/.test(domainPattern || '') ? domainPattern.replace(/\{(first|last|f|l)\}/g,(_,part)=>({first:f,last:l,f:f[0],l:l[0]})[part]) : '';
  return [...new Set([pattern,`${f}.${l}`,f,`${f[0]}${l}`,`${f}_${l}`,`${f}${l[0]}`].filter(Boolean))].map(local=>({email:`${local}@${domain}`,emailStatus:'unverified',emailInferred:true,source:pattern===local ? 'Observed domain pattern (mailbox unverified)' : 'Unverified name pattern'}));
}
