import {id,now,text,safeUrl,fail} from '../domain.mjs';
import {companyDomain,resolveCompany} from '../providers/contacts/company.mjs';
import {permuteEmails} from '../providers/contacts/permutator.mjs';
import {domainMailHealth} from '../providers/contacts/dns.mjs';

export async function queueBrowserContacts(data,store,queue) {
  let source;try{source=new URL(data.sourceUrl);}catch{fail('Import from a LinkedIn job or company people page.');}
  if(source.protocol!=='https:' || !/(^|\.)linkedin\.com$/.test(source.hostname) || !/^\/(?:company\/[^/]+(?:\/people)?|jobs\/view\/[^/]+)(?:\/|$)/.test(source.pathname))fail('Import visible profiles from a LinkedIn company or job page.');
  if(!Array.isArray(data.profiles) || !data.profiles.length || data.profiles.length>25)fail('Import 1–25 visible company profiles.');
  const company=text(data.company,150);if(company.length<2)fail('The page did not identify a company. Open its company people page.');
  const profiles=data.profiles.map(p=>{const url=safeUrl(p.linkedinUrl);if(!url || !/^https:\/\/(?:[a-z]+\.)?linkedin\.com\/in\/[a-z0-9_%.-]+\/?$/i.test(url))fail('Every profile needs a public LinkedIn /in/ link.');return {name:text(p.name,150),title:text(p.title,200),linkedinUrl:url};}).filter(p=>p.name.split(/\s+/).length>=2);
  if(!profiles.length)fail('No complete visible names were found.');
  const task=await queue.enqueue('contacts.browser-import',{company,profiles,sourceUrl:source.origin+source.pathname},{maxAttempts:1});
  return {taskId:task.id,message:`${profiles.length} visible profiles queued. Names and email suggestions will appear in Contacts; mailbox verification is separate.`};
}
export async function importBrowserContacts(task,store,config,fetcher=fetch,{lookupMx}={}) {
  const data=task.payload,company=await resolveCompany({company:data.company},fetcher,store),health=company ? await domainMailHealth(company.domain,{lookupMx,fetcher}) : null;
  await store.refresh();let added=0;
  for(const p of data.profiles) {
    const old=store.state.contacts.find(c=>c.linkedinUrl===p.linkedinUrl);if(old)continue;
    const parts=p.name.split(/\s+/),candidate=company ? permuteEmails({firstName:parts[0],lastName:parts.at(-1),companyDomain:company.domain,domainPattern:company.pattern})[0] : null;
    const email=candidate?.email || '';
    if(email && store.state.contacts.some(c=>c.email?.toLowerCase()===email))continue;
    store.state.contacts.push({id:id(),...p,email,emailStatus:health?.status==='invalid' ? 'invalid' : 'unverified',company:data.company,companyDomain:company?.domain || '',requiresDomainReview:!company || company.requiresDomainReview===true,source:'Browser-visible LinkedIn profile',sources:[{url:data.sourceUrl},{url:p.linkedinUrl}],domainVerification:health,verification:{provider:'Browser profile + email pattern',status:'unverified',at:now(),reference:p.linkedinUrl,result:email ? 'Name/title imported from the page. Email is a pattern suggestion, not a verified mailbox.' : 'No company domain was confirmed; no email has been guessed.'},isDemo:false,suppressed:false,createdAt:now()});added++;
  }
  if(company && companyDomain(company.domain))await store.db.prepare('INSERT INTO companies(domain,name,body) VALUES(?,?,?) ON CONFLICT(domain) DO UPDATE SET body=excluded.body').run(company.domain,data.company,JSON.stringify(company));
  await store.save();return {added,domain:company?.domain || null,status:'Imported for review'};
}
