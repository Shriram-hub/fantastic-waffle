import {withDeadline,boundedFetcher} from '../providers/deadline.mjs';
import {activity} from './autopilot-policy.mjs';
import {id,now,text,hash,safeUrl,emailValid,fail} from '../domain.mjs';
import {companyDomain,resolveCompany} from '../providers/contacts/company.mjs';
import {companyPattern,suggestCorporateEmails,observeCompanyEmails} from './company-patterns.mjs';
import {checkContactDomains} from '../providers/contacts/dns.mjs';
import {profileURL,uniquePeople} from '../../shared/contact-discovery.mjs';
import {observedEmail,resolvePersonEmail} from './person-email.mjs';
import {effectiveProviderConfig} from './provider-config.mjs';

function linkedInDomainEvidence(data){
  const domain=companyDomain(data.verifiedCompanyDomain),e=data.domainEvidence;
  if(!domain || e?.kind!=='linkedin-company-website')return null;
  try{const website=new URL(e.website),reference=new URL(e.reference),company=new URL(data.companyLinkedinUrl || e.reference);if(!/^https?:$/.test(website.protocol) || website.username || website.password || website.port || companyDomain(website.hostname)!==domain || reference.protocol!=='https:' || reference.username || reference.password || reference.port || !/(^|\.)linkedin\.com$/.test(reference.hostname) || !/^\/company\/[^/]+\/about\/?$/.test(reference.pathname) || reference.pathname.split('/')[2]!==company.pathname.split('/')[2])return null;
    return {domain,name:text(data.company,150),requiresDomainReview:false,source:'LinkedIn company Website field',reference:reference.href,website:website.href};
  }catch{return null;}
}
function browserPerson(p){
  if(!p || typeof p!=='object')fail('Use valid visible profile records.');const url=profileURL(p.linkedinUrl || p.profileUrl);if(!url)fail('Every profile needs a public LinkedIn /in/ link.');
  const name=text(p.name || p.fullName || [p.firstName,p.lastName].filter(Boolean).join(' '),150).split(/[,|·•]/)[0].replace(/\([^)]*\)/g,' ').replace(/^(?:Dr|Prof|Mr|Ms|Mrs|CA)\.?\s+/i,'').replace(/\b(?:CFA|MBA|CPA|ACA|CA|Ph\.?D|PMP|FRM|ACCA|LLB|B\.?Tech|M\.?Tech)\b\.?/gi,(match,offset,whole)=>whole.trim().split(/\s+/).length>2?' ':match).replace(/\s+(?:Ex-\S+|1st|2nd|3rd\+?)\b.*$/i,'').replace(/\s+/g,' ').trim();
  const kind=p.emailEvidence?.kind,directEmail=String(p.directEmail || '').trim().toLowerCase();
  const direct=emailValid(directEmail) && ['linkedin-contact-info','linkedin-profile-text'].includes(kind) && profileURL(p.emailEvidence?.reference)===url;
  return {name,title:text(p.title,200),location:text(p.location,150),linkedinUrl:url,...(direct?{directEmail,emailEvidence:{kind,reference:url,mailboxVerified:false}}:{})};
}

export async function queueBrowserContacts(data,store,queue,{tokenId=null,prepareInline=false,config={},fetcher=fetch,lookupMx}={}) {
  if(store.state.isDemo)fail('Start a personal workspace before importing real contacts.');
  let source;try{source=new URL(data.sourceUrl);}catch{fail('Import from a LinkedIn profile, company People page or people search.');}
  if(source.protocol!=='https:' || source.username || source.password || source.port || !/(^|\.)linkedin\.com$/.test(source.hostname) || !/^\/(?:in\/[^/]+|company\/[^/]+(?:\/people)?|jobs\/view\/[^/]+|search\/results\/people)(?:\/|$)/.test(source.pathname))fail('Import visible profiles from a supported LinkedIn page.');
  if(!Array.isArray(data.profiles) || !data.profiles.length || data.profiles.length>100)fail('Import 1–100 visible profiles.');
  const company=text(data.company,150);if(company.length<2)fail('Enter the current company shown on the profile or People page.');
  if(data.domain && !companyDomain(data.domain))fail('Use a corporate domain without paths or personal-email services.');
  if(data.allowSearch!==undefined && typeof data.allowSearch!=='boolean')fail('Choose whether to use search credits.');
  if(data.allowCredits!==undefined && typeof data.allowCredits!=='boolean')fail('Choose whether to use email-finder credits.');
  const profiles=uniquePeople(data.profiles.map(browserPerson).filter(p=>p.name.split(/\s+/).length>=2));
  if(source.pathname.startsWith('/in/') && (profiles.length!==1 || profiles[0].linkedinUrl!==profileURL(source.href)))fail('Get email can only import the person on this profile page.');
  if(!profiles.length)fail('No complete visible names were found.');
  const payload={company,domain:companyDomain(data.domain),domainConfirmed:data.domainConfirmed===true,linkedInCompany:linkedInDomainEvidence(data),companyLinkedinUrl:safeUrl(data.companyLinkedinUrl),profiles,sourceUrl:source.origin+source.pathname,allowCredits:data.allowCredits===true,allowSearch:data.allowSearch===true,tokenId},signature=hash(payload),dedupeKey=`browser-import:${Math.floor(Date.now()/86400000)}:${signature}`;
  const existing=await store.db.prepare('SELECT id FROM tasks WHERE dedupe_key=?').get(dedupeKey);
  if(existing){const task=await queue.get(existing.id);if(task.status==='failed' && prepareInline)await queue.retry(task.id);return {...await browserImportResult(task.id,store,queue,tokenId),count:profiles.length};}
  if(prepareInline){const prepared=await prepareBrowserPeople(payload,store,config,fetcher,{lookupMx}),saved=await persistBrowserPeople(prepared,store,payload);Object.assign(payload,{preparedCompany:prepared.company,preparedHealth:prepared.contacts[0]?.domainVerification,preparedContactIds:saved.contactIds});}
  const task=await queue.enqueue('contacts.browser-import',payload,{maxAttempts:1,dedupeKey});
  const contacts=browserContactRows(payload.preparedContactIds || [],store);
  return {contacts,taskId:task.id,count:profiles.length,status:task.status,message:contacts.length?`${contacts.length} contacts saved. Suggestions are ready; optional mailbox verification continues in the background.`:`${profiles.length} visible profile(s) queued. Domain and pattern checks do not verify individual mailboxes.`};
}
async function prepareBrowserPeople(data,store,config,fetcher,{lookupMx,worker=false}={}) {
  // A company URL observed on LinkedIn takes precedence over a hostname guessed from its name.
  const observed=data.linkedInCompany,explicit=data.domain && (!observed || data.domain!==observed.domain && data.domainConfirmed);
  let company=data.preparedCompany || (explicit?{domain:data.domain,name:data.company,requiresDomainReview:!data.domainConfirmed,source:data.domainConfirmed?'User-confirmed corporate website':'Browser domain suggestion',reference:`https://${data.domain}`} : observed || await withDeadline(signal=>resolveCompany({company:data.company},boundedFetcher(fetcher,signal),store),3500).catch(()=>null));
  if(company)company={...await companyPattern(store,company.domain),...company};
  const profiles=data.profiles.map(p=>({...p,company:data.company,emailStatus:'unverified',source:'Browser-visible LinkedIn profile',companyAssociation:'Company selected from the visible page; review current employment',sources:[{url:data.sourceUrl},{url:p.linkedinUrl}]}));
  let contacts;
  if(worker){
    const effective=await effectiveProviderConfig(store,config);contacts=[];
    // Keep provider calls bounded; every request has a durable reservation and daily budget.
    for(let offset=0;offset<profiles.length;offset+=4){const batch=await Promise.allSettled(profiles.slice(offset,offset+4).map(person=>resolvePersonEmail(person,company,{store,config:effective,fetcher,allowCredits:data.allowCredits,allowSearch:data.allowSearch,domainHealth:data.preparedHealth})));for(let i=0;i<batch.length;i++)contacts.push(batch[i].status==='fulfilled'?batch[i].value:{...(company?suggestCorporateEmails([profiles[offset+i]],company)[0]:profiles[offset+i]),lookupWarnings:['Exact-person lookup could not complete. Any naming suggestion remains unverified.']});}
  }else contacts=company?suggestCorporateEmails(profiles.map(p=>p.directEmail?observedEmail(p,p.directEmail,p.emailEvidence):p),company):profiles.map(p=>p.directEmail?observedEmail(p,p.directEmail,p.emailEvidence):p);
  contacts=data.preparedHealth && data.preparedHealth.status!=='unknown'?contacts.map(c=>({...c,domainVerification:data.preparedHealth.domain===(c.email || '').split('@')[1]?data.preparedHealth:c.domainVerification})):await checkContactDomains(contacts,{lookupMx,fetcher});
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
function browserContactRows(ids,store){return ids.map(id=>store.state.contacts.find(c=>c.id===id)).filter(c=>c && !c.suppressed).map(({id,name,title,email,emailStatus,alternateEmails,company,companyDomain,domainVerification,requiresDomainReview,emailInferred,emailObserved,emailEvidence,emailPattern,emailResolution,confidence,confidenceMeaning,lookupWarnings,verification})=>({id,name,title,email,emailStatus,alternateEmails:alternateEmails || [],company,companyDomain,domainVerification,requiresDomainReview,emailInferred,emailObserved,emailEvidence,emailPattern,emailResolution,confidence,confidenceMeaning,lookupWarnings,verification}));}
export async function browserContactContext(company,store,config={},fetcher=fetch,evidence={}){
  const name=text(company,150),effective=await effectiveProviderConfig(store,config),available={mailboxConfigured:!!(effective.HUNTER_API_KEY || effective.PROSPEO_API_KEY || effective.GETPROSPECT_API_KEY),searchConfigured:!!(effective.SERPER_API_KEY || effective.TAVILY_API_KEY)};if(name.length<2)return {...available,company:'',domain:'',requiresDomainReview:true};
  const found=linkedInDomainEvidence({...evidence,company:name}) || await withDeadline(signal=>resolveCompany({company:name},boundedFetcher(fetcher,signal),store),3500).catch(()=>null);
  return {...available,company:name,domain:found?.domain || '',requiresDomainReview:!found || found.requiresDomainReview===true,source:found?.source || 'Enter corporate domain'};
}
export async function browserImportResult(taskId,store,queue,tokenId) {
  const task=await queue.get(taskId);if(!task || task.kind!=='contacts.browser-import' || tokenId && task.payload.tokenId!==tokenId)fail('Browser import not found.',404);
  const contacts=browserContactRows(task.result?.contactIds || task.payload.preparedContactIds || [],store);
  return {taskId:task.id,status:task.status,count:task.payload.profiles.length,contacts,message:task.status==='failed'?'This import could not complete. Retry from the profile or check Contacts in Veloce.':task.status==='completed'?`${contacts.length} profile(s) processed. Mailbox verification is separate from domain MX.`:'Checking company domain and email suggestions in the background.'};
}
