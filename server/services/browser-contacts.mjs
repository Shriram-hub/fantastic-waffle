import {id,now,text,hash,safeUrl,fail} from '../domain.mjs';
import {companyDomain,resolveCompany} from '../providers/contacts/company.mjs';
import {companyPattern,suggestCorporateEmails,observeCompanyEmails} from './company-patterns.mjs';
import {checkContactDomains} from '../providers/contacts/dns.mjs';
import {profileURL,uniquePeople} from '../../shared/contact-discovery.mjs';
import {findCompanyContacts} from './contact-discovery.mjs';
import {effectiveProviderConfig} from './provider-config.mjs';

export async function queueBrowserContacts(data,store,queue,{tokenId=null}={}) {
  if(store.state.isDemo)fail('Start a personal workspace before importing real contacts.');
  let source;try{source=new URL(data.sourceUrl);}catch{fail('Import from a LinkedIn profile, company People page or people search.');}
  if(source.protocol!=='https:' || source.username || source.password || source.port || !/(^|\.)linkedin\.com$/.test(source.hostname) || !/^\/(?:in\/[^/]+|company\/[^/]+(?:\/people)?|jobs\/view\/[^/]+|search\/results\/people)(?:\/|$)/.test(source.pathname))fail('Import visible profiles from a supported LinkedIn page.');
  if(!Array.isArray(data.profiles) || !data.profiles.length || data.profiles.length>100)fail('Import 1–100 visible profiles.');
  const company=text(data.company,150);if(company.length<2)fail('Enter the current company shown on the profile or People page.');
  if(data.domain && !companyDomain(data.domain))fail('Use a corporate domain without paths or personal-email services.');
  if(data.allowCredits!==undefined && typeof data.allowCredits!=='boolean')fail('Choose whether to use email-finder credits.');
  const profiles=uniquePeople(data.profiles.map(p=>{if(!p || typeof p!=='object')fail('Use valid visible profile records.');const url=profileURL(p.linkedinUrl || p.profileUrl);if(!url)fail('Every profile needs a public LinkedIn /in/ link.');return {name:text(p.name || p.fullName || [p.firstName,p.lastName].filter(Boolean).join(' '),150),title:text(p.title,200),location:text(p.location,150),linkedinUrl:url};}).filter(p=>p.name.split(/\s+/).length>=2));
  if(source.pathname.startsWith('/in/') && (profiles.length!==1 || profiles[0].linkedinUrl!==profileURL(source.href)))fail('Get email can only import the person on this profile page.');
  if(!profiles.length)fail('No complete visible names were found.');
  const payload={company,domain:companyDomain(data.domain),domainConfirmed:data.domainConfirmed===true,profiles,sourceUrl:source.origin+source.pathname,allowCredits:data.allowCredits===true,tokenId},signature=hash(payload);
  const task=await queue.enqueue('contacts.browser-import',payload,{maxAttempts:1,dedupeKey:`browser-import:${Math.floor(Date.now()/86400000)}:${signature}`});
  return {taskId:task.id,count:profiles.length,status:task.status,message:`${profiles.length} visible profile(s) queued. Domain and pattern checks do not verify individual mailboxes.`};
}
export async function importBrowserContacts(task,store,config={},fetcher=fetch,{lookupMx}={}) {
  const data=task.payload;
  let company=data.domain?{domain:data.domain,name:data.company,requiresDomainReview:!data.domainConfirmed,source:data.domainConfirmed?'User-confirmed corporate website':'Browser domain suggestion',reference:`https://${data.domain}`} : await resolveCompany({company:data.company},fetcher,store);
  if(company)company={...await companyPattern(store,company.domain),...company};
  const profiles=data.profiles.map(p=>({...p,company:data.company,emailStatus:'unverified',source:'Browser-visible LinkedIn profile',companyAssociation:'Company selected from the visible page; review current employment',sources:[{url:data.sourceUrl},{url:p.linkedinUrl}]}));
  let contacts=company?suggestCorporateEmails(profiles,company):profiles;
  contacts=await checkContactDomains(contacts,{lookupMx,fetcher});
  if(company && data.allowCredits){const effective=await effectiveProviderConfig(store,config),found=await findCompanyContacts({company:data.company,title:'Career opportunities'},company,{store,config:effective,fetcher,lookupMx,allowCredits:true,allowPublic:false,seedOnly:true,seedContacts:contacts,limit:contacts.length,targetCount:contacts.length,domainHealth:contacts[0]?.domainVerification,dailyLimit:Math.min(100,Number(effective.CONTACT_API_DAILY_LIMIT)||20)});contacts=found.contacts;}
  await store.refresh();let added=0;const contactIds=[];
  for(const incoming of contacts) {
    const previous=store.state.contacts.find(c=>c.linkedinUrl===incoming.linkedinUrl || incoming.email && c.email?.toLowerCase()===incoming.email.toLowerCase());if(previous?.suppressed || previous?.isDemo)continue;
    const invalid=incoming.domainVerification?.status==='invalid';
    const record={...incoming,source:'Browser-visible LinkedIn profile',email:incoming.email || '',emailStatus:invalid?'invalid':incoming.emailStatus || 'unverified',requiresDomainReview:!company || company.requiresDomainReview===true,companyDomain:company?.domain || '',company:data.company,isDemo:false,suppressed:false,createdAt:now()};
    let contact=previous;
    if(!contact){contact={...record,id:id()};store.state.contacts.push(contact);added++;}
    else if(contact.emailStatus!=='verified'){Object.assign(contact,record,{id:contact.id,createdAt:contact.createdAt});}
    contactIds.push(contact.id);
  }
  if(company && companyDomain(company.domain))await observeCompanyEmails(store,company,contacts);
  await store.save();return {added,contactIds,domain:company?.domain || null,status:'Imported for review'};
}
export async function browserImportResult(taskId,store,queue,tokenId) {
  const task=await queue.get(taskId);if(!task || task.kind!=='contacts.browser-import' || tokenId && task.payload.tokenId!==tokenId)fail('Browser import not found.',404);
  const contacts=(task.result?.contactIds || []).map(id=>store.state.contacts.find(c=>c.id===id)).filter(c=>c && !c.suppressed).map(({id,name,title,email,emailStatus,company,companyDomain,domainVerification,requiresDomainReview,emailInferred,confidence,verification})=>({id,name,title,email,emailStatus,company,companyDomain,domainVerification,requiresDomainReview,emailInferred,confidence,verification}));
  return {taskId:task.id,status:task.status,count:task.payload.profiles.length,contacts,message:task.status==='failed'?'This import could not complete. Retry from the profile or check Contacts in Veloce.':task.status==='completed'?`${contacts.length} profile(s) processed. Mailbox verification is separate from domain MX.`:'Checking company domain and email suggestions in the background.'};
}
