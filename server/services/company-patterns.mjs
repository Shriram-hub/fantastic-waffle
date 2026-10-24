import {learnEmailPattern,permuteEmails} from '../providers/contacts/permutator.mjs';
import {now} from '../domain.mjs';
export function suggestCorporateEmails(people,company) {
  const pattern=company.learnedPattern || company.providerPattern || company.snippetPattern,format=pattern?.pattern || company.pattern;
  const suggestions=people.map(p=>{
    const parts=String(p.name || p.fullName || '').trim().split(/\s+/),candidates=permuteEmails({firstName:p.firstName || parts[0],lastName:p.lastName || parts.at(-1),companyDomain:company.domain,domainPattern:format}),candidate=p.email?{alternateEmails:[...new Set(candidates.map(c=>c.email).filter(e=>e!==p.email))]}:candidates[0] || {};
    return {...p,...candidate,companyDomain:company.domain,emailPattern:format?{pattern:format,status:pattern?.status || 'reported-format',sampleCount:pattern?.sampleCount || 0}:null,confidence:p.emailObserved?null:p.emailStatus==='verified'?p.confidence ?? 100:format?(pattern?.status==='corroborated'?75:60):35,confidenceMeaning:p.emailObserved?'Published address evidence; consult the mailbox verification status':'Naming-pattern confidence, not probability of mailbox delivery',verification:p.verification || {provider:'Company email pattern',status:'unverified',at:now(),reference:p.linkedinUrl,result:format?'Company naming convention applied; mailbox remains unverified.':'No observed format: common-name suggestion; mailbox remains unverified.'}};
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

// A masked value is compatibility evidence, never proof of a full naming rule
// or of an individual mailbox. An initial followed by stars is ambiguous.
export function extractPatternFromSnippets(snippets,domain,people=[]) {
  const patterns=['{first}.{last}','{f}{last}','{first}_{last}','{first}{l}','{first}','{last}.{first}'],claims=[],masked=[],observedEmails=[];
  const aliases={'first.last':'{first}.{last}','firstname.lastname':'{first}.{last}','first_last':'{first}_{last}','firstname_lastname':'{first}_{last}','flast':'{f}{last}','firstinitiallast':'{f}{last}','firstl':'{first}{l}','first':'{first}','firstname':'{first}','last.first':'{last}.{first}'};
  const escape=v=>String(v).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),rx=new RegExp(`([a-z0-9*._{}\\[\\]-]+)@${escape(domain)}\\b`,'gi');
  for(const result of snippets.slice(0,30)){
    const body=String(typeof result==='string'?result:`${result.title || ''} ${result.snippet || ''}`).slice(0,2500),reference=typeof result==='object'?result.link || result.url || '':'';
    for(const match of body.matchAll(rx)){
      const local=match[1].toLowerCase(),email=`${local}@${domain}`;
      if(local.includes('*')){let candidates=local.includes('.')?['{first}.{last}','{last}.{first}']:local.includes('_')?['{first}_{last}']:['{first}','{f}{last}','{first}{l}'];const person=people.find(p=>body.toLowerCase().includes(String(p.name || p.fullName || '').toLowerCase()) && (p.name || p.fullName || '').trim().split(/\s+/).length>=2);if(person && local.includes('.')){const parts=String(person.name || person.fullName).toLowerCase().split(/\s+/),f=parts[0][0],l=parts.at(-1)[0],tokens=local.split('.');if(f!==l && tokens[0][0]===f && tokens[1]?.[0]===l)candidates=['{first}.{last}'];}masked.push({example:email,candidates,reference,status:'compatible-masked'});continue;}
      const key=local.replace(/[{}\[\]]/g,'');if(aliases[key] && /format|pattern/i.test(body))claims.push({pattern:aliases[key],reference,status:'public-format-claim'});
      else if(/^[a-z][a-z0-9._-]*$/.test(local))observedEmails.push({email,reference,status:'publicly-observed',mailboxVerified:false});
    }
  }
  const declared=[...new Set(claims.map(c=>c.pattern))],candidates=[...new Set([...declared,...masked.flatMap(m=>m.candidates)])].filter(p=>patterns.includes(p));
  return {pattern:declared.length===1?declared[0]:null,status:declared.length===1?'public-format-claim':declared.length>1?'conflicting':'unconfirmed',candidates,claims,masked,observedEmails:[...new Map(observedEmails.map(e=>[e.email,e])).values()],mailboxVerified:false};
}
