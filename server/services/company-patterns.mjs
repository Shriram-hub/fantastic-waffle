import {learnEmailPattern,permuteEmails} from '../providers/contacts/permutator.mjs';
import {now} from '../domain.mjs';
export function suggestCorporateEmails(people,company) {
  const pattern=company.learnedPattern || company.providerPattern,format=pattern?.pattern || company.pattern;
  const suggestions=people.map(p=>{
    const parts=String(p.name || p.fullName || '').trim().split(/\s+/),candidate=p.email?{}:permuteEmails({firstName:p.firstName || parts[0],lastName:p.lastName || parts.at(-1),companyDomain:company.domain,domainPattern:format})[0] || {};
    return {...p,...candidate,companyDomain:company.domain,emailPattern:pattern?{pattern:pattern.pattern,status:pattern.status,sampleCount:pattern.sampleCount || 0}:null,confidence:p.emailStatus==='verified'?p.confidence ?? 100:format?(pattern?.status==='corroborated'?75:60):35,confidenceMeaning:'Naming-pattern confidence, not probability of mailbox delivery',verification:p.verification || {provider:'Company email pattern',status:'unverified',at:now(),reference:p.linkedinUrl,result:format?'Company naming convention applied; mailbox remains unverified.':'No observed format: common-name suggestion; mailbox remains unverified.'}};
  });
  const counts=new Map();for(const p of suggestions)if(p.emailInferred && p.email)counts.set(p.email,(counts.get(p.email)||0)+1);
  return suggestions.map(p=>p.emailInferred && counts.get(p.email)>1?{...p,suggestedEmail:p.email,email:'',confidence:0,verification:{...p.verification,result:'This inferred address matches multiple people. Resolve the naming ambiguity before use.'}}:p);
}
export async function companyPattern(store,domain) {
  const row=await store.db.prepare('SELECT body FROM companies WHERE domain=?').get(domain);
  return row ? JSON.parse(row.body) : {};
}
export async function observeCompanyEmails(store,company,contacts) {
  const old=await companyPattern(store,company.domain),learned=learnEmailPattern(contacts,company.domain,old.learnedPattern || company.learnedPattern);
  const next={...old,...company,...(learned ? {learnedPattern:learned,pattern:learned.pattern} : {})};
  await store.db.prepare('INSERT INTO companies(domain,name,body) VALUES(?,?,?) ON CONFLICT(domain) DO UPDATE SET body=excluded.body').run(company.domain,company.name || old.name || company.domain,JSON.stringify(next));
  Object.assign(company,next);return next;
}
