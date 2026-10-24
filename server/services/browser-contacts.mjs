import {withDeadline,boundedFetcher} from '../providers/deadline.mjs';
import {activity} from './autopilot-policy.mjs';
import {searchEmailEvidence} from '../providers/contacts/serper-xray.mjs';
import {providerCall} from './provider-budget.mjs';
import {id,now,text,hash,safeUrl,fail} from '../domain.mjs';
import {companyDomain,resolveCompany} from '../providers/contacts/company.mjs';
import {companyPattern,suggestCorporateEmails,observeCompanyEmails,extractPatternFromSnippets} from './company-patterns.mjs';
import {checkContactDomains} from '../providers/contacts/dns.mjs';
import {profileURL,uniquePeople} from '../../shared/contact-discovery.mjs';
import {findCompanyContacts} from './contact-discovery.mjs';
import {effectiveProviderConfig} from './provider-config.mjs';

export async function queueBrowserContacts(data,store,queue,{tokenId=null,prepareInline=false,config={},fetcher=fetch,lookupMx}={}) {
  if(store.state.isDemo)fail('Start a personal workspace before importing real contacts.');
  let source;try{source=new URL(data.sourceUrl);}catch{fail('Import from a LinkedIn profile, company People page or people search.');}
  if(source.protocol!=='https:' || source.username || source.password || source.port || !/(^|\.)linkedin\.com$/.test(source.hostname) || !/^\/(?:in\/[^/]+|company\/[^/]+(?:\/people)?|jobs\/view\/[^/]+|search\/results\/people)(?:\/|$)/.test(source.pathname))fail('Import visible profiles from a supported LinkedIn page.');
  if(!Array.isArray(data.profiles) || !data.profiles.length || data.profiles.length>100)fail('Import 1–100 visible profiles.');
  const company=text(data.company,150);if(company.length<2)fail('Enter the current company shown on the profile or People page.');
  if(data.domain && !companyDomain(data.domain))fail('Use a corporate domain without paths or personal-email services.');
  if(data.allowSearch!==undefined && typeof data.allowSearch!=='boolean')fail('Choose whether to use search credits.');
  if(data.allowCredits!==undefined && typeof data.allowCredits!=='boolean')fail('Choose whether to use email-finder credits.');
  const profiles=uniquePeople(data.profiles.map(p=>{if(!p || typeof p!=='object')fail('Use valid visible profile records.');const url=profileURL(p.linkedinUrl || p.profileUrl);if(!url)fail('Every profile needs a public LinkedIn /in/ link.');return {name:text(p.name || p.fullName || [p.firstName,p.lastName].filter(Boolean).join(' '),150),title:text(p.title,200),location:text(p.location,150),linkedinUrl:url};}).filter(p=>p.name.split(/\s+/).length>=2));
  if(source.pathname.startsWith('/in/') && (profiles.length!==1 || profiles[0].linkedinUrl!==profileURL(source.href)))fail('Get email can only import the person on this profile page.');
  if(!profiles.length)fail('No complete visible names were found.');
  const payload={company,domain:companyDomain(data.domain),domainConfirmed:data.domainConfirmed===true,profiles,sourceUrl:source.origin+source.pathname,allowCredits:data.allowCredits===true,allowSearch:data.allowSearch===true,tokenId},signature=hash(payload),dedupeKey=`browser-import:${Math.floor(Date.now()/86400000)}:${signature}`;
  const existing=await store.db.prepare('SELECT id FROM tasks WHERE dedupe_key=?').get(dedupeKey);
  if(existing){const task=await queue.get(existing.id);if(task.status==='failed' && prepareInline)await queue.retry(task.id);return {...await browserImportResult(task.id,store,queue,tokenId),count:profiles.length};}
  if(prepareInline){const prepared=await prepareBrowserPeople(payload,store,config,fetcher,{lookupMx}),saved=await persistBrowserPeople(prepared,store,payload);Object.assign(payload,{preparedCompany:prepared.company,preparedHealth:prepared.contacts[0]?.domainVerification,preparedContactIds:saved.contactIds});}
  const task=await queue.enqueue('contacts.browser-import',payload,{maxAttempts:1,dedupeKey});
  const contacts=browserContactRows(payload.preparedContactIds || [],store);
  return {contacts,taskId:task.id,count:profiles.length,status:task.status,message:contacts.length?`${contacts.length} contacts saved. Suggestions are ready; optional mailbox verification continues in the background.`:`${profiles.length} visible profile(s) queued. Domain and pattern checks do not verify individual mailboxes.`};
}
async function prepareBrowserPeople(data,store,config,fetcher,{lookupMx,worker=false}={}) {
  let company=data.preparedCompany || (data.domain?{domain:data.domain,name:data.company,requiresDomainReview:!data.domainConfirmed,source:data.domainConfirmed?'User-confirmed corporate website':'Browser domain suggestion',reference:`https://${data.domain}`} : await withDeadline(signal=>resolveCompany({company:data.company},boundedFetcher(fetcher,signal),store),3500).catch(()=>null));
  if(company)company={...await companyPattern(store,company.domain),...company};
  const profiles=data.profiles.map(p=>({...p,company:data.company,emailStatus:'unverified',source:'Browser-visible LinkedIn profile',companyAssociation:'Company selected from the visible page; review current employment',sources:[{url:data.sourceUrl},{url:p.linkedinUrl}]}));
  if(worker && company && data.allowSearch){const effective=await effectiveProviderConfig(store,config),found=await searchEmailEvidence(company.domain,effective,{fetcher,call:(provider,fn,key)=>providerCall(store,`email-evidence-v1:${hash(effective[provider==='Serper'?'SERPER_API_KEY':'TAVILY_API_KEY'] || '')}:${company.domain}:${Math.floor(Date.now()/86400000)}:${key}`,provider,Math.min(500,Number(effective.CONTACT_SEARCH_DAILY_LIMIT)||100),fn)}),evidence=extractPatternFromSnippets(found.results,company.domain,profiles);if(evidence.pattern)company.snippetPattern={...evidence,sampleCount:0};for(const person of profiles){const result=found.results.find(r=>`${r.title || ''} ${r.snippet || ''}`.toLowerCase().includes(person.name.toLowerCase()));if(!result)continue;const direct=extractPatternFromSnippets([result],company.domain).observedEmails.filter(e=>! /^(careers?|hr|info|support|jobs|contact|talent)@/i.test(e.email));if(direct.length===1)Object.assign(person,{email:direct[0].email,emailObserved:true,emailInferred:false,verification:{provider:'Public indexed page',status:'unverified',at:now(),reference:direct[0].reference,result:'A public snippet mentions this name and address. Review the source; mailbox verification is separate.'}});}}
  let contacts=company?suggestCorporateEmails(profiles,company):profiles;
  contacts=data.preparedHealth && data.preparedHealth.status!=='unknown'?contacts.map(c=>({...c,domainVerification:data.preparedHealth})):await checkContactDomains(contacts,{lookupMx,fetcher});
  if(worker && company && data.allowCredits){const effective=await effectiveProviderConfig(store,config),found=await findCompanyContacts({company:data.company,title:'Career opportunities'},company,{store,config:effective,fetcher,lookupMx,allowCredits:true,allowPublic:false,seedOnly:true,seedContacts:contacts,limit:contacts.length,targetCount:contacts.length,tryAlternates:true,domainHealth:contacts[0]?.domainVerification,dailyLimit:Math.min(100,Number(effective.CONTACT_API_DAILY_LIMIT)||20)});contacts=found.contacts;}
  return {company,contacts};
}
async function persistBrowserPeople({company,contacts},store,data) {
  await store.refresh();let added=0;const contactIds=[];
  for(const incoming of contacts) {
    const previous=store.state.contacts.find(c=>c.linkedinUrl===incoming.linkedinUrl && (company? !c.companyDomain || c.companyDomain===company.domain : c.company?.toLowerCase()===data.company.toLowerCase()) || incoming.email && c.email?.toLowerCase()===incoming.email.toLowerCase());if(previous?.suppressed || previous?.isDemo)continue;
    const invalid=incoming.domainVerification?.status==='invalid';
    const record={...incoming,source:'Browser-visible LinkedIn profile',email:incoming.email || '',emailStatus:invalid?'invalid':incoming.emailStatus || 'unverified',requiresDomainReview:!company || company.requiresDomainReview===true,companyDomain:company?.domain || '',company:data.company,isDemo:false,suppressed:false,createdAt:now()};
    let contact=previous;
    if(!contact){contact={...record,id:id()};store.state.contacts.push(contact);added++;}
    else if(contact.emailStatus!=='verified'){const held=contact.emailStatus==='invalid' && contact.email===record.email && record.emailStatus!=='verified'?{emailStatus:contact.emailStatus,verification:contact.verification}:{};Object.assign(contact,record,{id:contact.id,createdAt:contact.createdAt},held);}
    contactIds.push(contact.id);
  }
  if(company && companyDomain(company.domain))await observeCompanyEmails(store,company,contacts);
  await store.save();await activity(store,'contacts',`${data.company}: ${contactIds.length} browser profiles saved; ${contacts.filter(c=>c.emailStatus==='verified').length} verified mailboxes.`,added);return {added,contactIds,domain:company?.domain || null,status:'Imported for review'};
}
export async function importBrowserContacts(task,store,config={},fetcher=fetch,dependencies={}) {
  const prepared=await prepareBrowserPeople(task.payload,store,config,fetcher,{...dependencies,worker:true});return persistBrowserPeople(prepared,store,task.payload);
}
function browserContactRows(ids,store){return ids.map(id=>store.state.contacts.find(c=>c.id===id)).filter(c=>c && !c.suppressed).map(({id,name,title,email,emailStatus,alternateEmails,company,companyDomain,domainVerification,requiresDomainReview,emailInferred,confidence,verification})=>({id,name,title,email,emailStatus,alternateEmails:alternateEmails || [],company,companyDomain,domainVerification,requiresDomainReview,emailInferred,confidence,verification}));}
export async function browserContactContext(company,store,config={},fetcher=fetch){
  const name=text(company,150),effective=await effectiveProviderConfig(store,config),available={mailboxConfigured:!!(effective.HUNTER_API_KEY || effective.PROSPEO_API_KEY || effective.GETPROSPECT_API_KEY),searchConfigured:!!(effective.SERPER_API_KEY || effective.TAVILY_API_KEY)};if(name.length<2)return {...available,company:'',domain:'',requiresDomainReview:true};
  const found=await withDeadline(signal=>resolveCompany({company:name},boundedFetcher(fetcher,signal),store),3500).catch(()=>null);
  return {...available,company:name,domain:found?.domain || '',requiresDomainReview:!found || found.requiresDomainReview===true,source:found?.source || 'Enter corporate domain'};
}
export async function browserImportResult(taskId,store,queue,tokenId) {
  const task=await queue.get(taskId);if(!task || task.kind!=='contacts.browser-import' || tokenId && task.payload.tokenId!==tokenId)fail('Browser import not found.',404);
  const contacts=browserContactRows(task.result?.contactIds || task.payload.preparedContactIds || [],store);
  return {taskId:task.id,status:task.status,count:task.payload.profiles.length,contacts,message:task.status==='failed'?'This import could not complete. Retry from the profile or check Contacts in Veloce.':task.status==='completed'?`${contacts.length} profile(s) processed. Mailbox verification is separate from domain MX.`:'Checking company domain and email suggestions in the background.'};
}
