import {companyDomain} from './company.mjs';
export function permuteEmails({firstName,lastName,companyDomain:domain,domainPattern}) {
  domain=companyDomain(domain);
  const f=String(firstName || '').toLowerCase().replace(/[^a-z]/g,''),l=String(lastName || '').toLowerCase().replace(/[^a-z]/g,'');
  if(!domain || !f || !l) return [];
  const pattern=/^(?:[._-]|\{(?:first|last|f|l)\})+$/.test(domainPattern || '') ? domainPattern.replace(/\{(first|last|f|l)\}/g,(_,part)=>({first:f,last:l,f:f[0],l:l[0]})[part]) : '';
  return [...new Set([pattern,`${f}.${l}`,f,`${f[0]}${l}`,`${f}_${l}`,`${f}${l[0]}`].filter(Boolean))].map(local=>({email:`${local}@${domain}`,emailStatus:'unverified',source:pattern===local ? 'Hunter domain pattern (mailbox unverified)' : 'Unverified name pattern'}));
}
