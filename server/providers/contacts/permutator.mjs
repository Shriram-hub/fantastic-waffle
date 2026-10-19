import {companyDomain} from './company.mjs';
export function permuteEmails({firstName,lastName,companyDomain:domain}) {
  domain=companyDomain(domain);
  const f=String(firstName || '').toLowerCase().replace(/[^a-z]/g,''),l=String(lastName || '').toLowerCase().replace(/[^a-z]/g,'');
  if(!domain || !f || !l) return [];
  return [...new Set([`${f}.${l}`,f,`${f[0]}${l}`,`${f}_${l}`,`${f}${l[0]}`])].map(local=>({email:`${local}@${domain}`,emailStatus:'unverified',source:'Unverified name pattern'}));
}
