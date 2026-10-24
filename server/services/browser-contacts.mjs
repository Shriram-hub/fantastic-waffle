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
  return {name,title:text(p.title,200),location:text(p.location,150),linkedinUrl:url,company:text(p.company,150),companyAssociation:text(p.companyAssociation,250),verifiedCompanyDomain:companyDomain(p.verifiedCompanyDomain),linkedInCompany:linkedInDomainEvidence(p),...(direct?{directEmail,emailEvidence:{kind,reference:url,mailboxVerified:false}}:{})};
}

export async function queueBrowserContacts(data,store,queue,{tokenId=null,prepareInline=false,config={},fetcher=fetch,lookupMx}={}) {
  if(store.state.isDemo)fail('Start a personal workspace before importing real contacts.');
  let source;try{source=new URL(data.sourceUrl);}catch{fail('Import from a LinkedIn profile, company People page or people search.');}
  if(source.protocol!=='https:' || source.username || source.password || source.port || !/(^|\.)linkedin\.com$/.test(source.hostname) || !/^\/(?:in\/[^/]+|company\/[^/]+(?:\/people)?|jobs\/view\/[^/]+|search\/results\/people)(?:\/|$)/.test(source.pathname))fail('Import visible profiles from a supported LinkedIn page.');
  if(!Array.isArray(data.profiles) || !data.profiles.length || data.profiles.length>100)fail('Import 1–100 visible profiles.');
  const company=text(data.company,150);
  if(data.domain && !companyDomain(data.domain))fail('Use a corporate domain without paths or personal-email services.');
  if(data.allowSearch!==undefined && typeof data.allowSearch!=='boolean')fail('Choose whether to use search credits.');
  if(data.allowCredits!==undefined && typeof data.allowCredits!=='boolean')fail('Choose whether to use email-finder credits.');
  const profiles=uniquePeople(data.profiles.map(browserPerson).filter(p=>p.name.split(/\s+/).length>=2));
  if(source.pathname.startsWith('/in/') && (profiles.length!==1 || profiles[0].linkedinUrl!==profileURL(source.href)))fail('Get email can only import the person on this profile page.');
  if(!profiles.length)fail('No complete visible names were found.');
  const payload={company,companyOverride:data.companyOverride===true,domain:companyDomain(data.domain),domainConfirmed:data.domainConfirmed===true,linkedInCompany:linkedInDomainEvidence(data),companyLinkedinUrl:safeUrl(data.companyLinkedinUrl),profiles,sourceUrl:source.origin+source.pathname,allowCredits:data.allowCredits===true,allowSearch:data.allowSearch===true,tokenId},signature=hash(payload),dedupeKey=`browser-import:${Math.floor(Date.now()/86400000)}:${signature}`;
  const existing=await store.db.prepare('SELECT id FROM tasks WHERE dedupe_key=?').get(dedupeKey);
  if(existing){const task=await queue.get(existing.id);if(task.status==='failed' && prepareInline)await queue.retry(task.id);return {...await browserImportResult(task.id,store,queue,tokenId),count:profiles.length};}
  if(prepareInline){const prepared=await prepareBrowserPeople(payload,store,config,fetcher,{lookupMx}),saved=await persistBrowserPeople(prepared,store,payload);Object.assign(payload,{preparedCompany:prepared.company,preparedCompanies:Object.fromEntries(prepared.contacts.map(c=>[c.linkedinUrl,c.resolvedCompany || null])),preparedHealthByDomain:Object.fromEntries(prepared.contacts.filter(c=>c.domainVerification?.domain).map(c=>[c.domainVerification.domain,c.domainVerification])),preparedHealth:prepared.contacts[0]?.domainVerification,preparedContactIds:saved.contactIds});}
  const task=await queue.enqueue('contacts.browser-import',payload,{maxAttempts:1,dedupeKey});
  const contacts=browserContactRows(payload.preparedContactIds || [],store);
  return {contacts,taskId:task.id,count:profiles.length,status:task.status,message:contacts.length?`${contacts.length} contacts saved. Suggestions are ready; optional mailbox verification continues in the background.`:`${profiles.length} visible profile(s) queued. Domain and pattern checks do not verify individual mailboxes.`};
}
async function prepareBrowserPeople(data,store,config,fetcher,{lookupMx,worker=false}={}) {
  const fallbackCompany=data.companyOverride || data.profiles.length===1 || /\/(?:company|jobs)\//.test(new URL(data.sourceUrl).pathname) || data.domainConfirmed && data.domain?data.company:'';
  const companies=new Map(),resolutions=new Map(),effective=worker?await effectiveProviderConfig(store,config):config;
  async function companyFor(person){
    const name=data.companyOverride?data.company:person.company || fallbackCompany || '',observed=person.linkedInCompany || (!person.company || person.company.toLowerCase()===data.company?.toLowerCase()?data.linkedInCompany:null);
    const domain=data.companyOverride?data.domain:person.verifiedCompanyDomain || ((!person.company || person.company.toLowerCase()===data.company?.toLowerCase())?data.domain:'');
    const key=JSON.stringify([name,domain,observed?.domain,data.companyOverride]);
    if(!resolutions.has(key))resolutions.set(key,(async()=>{
      let company=data.preparedCompanies?.[person.linkedinUrl] || (data.preparedCompany && (!name || name.toLowerCase()===data.company?.toLowerCase())?data.preparedCompany:null);
      if(!company){
        if(domain && (data.companyOverride || !observed || data.domainConfirmed && domain!==observed.domain))company={domain,name,requiresDomainReview:!data.domainConfirmed,source:data.domainConfirmed?'User-confirmed corporate website':'Browser domain suggestion',reference:`https://${domain}`};
        else company=observed || (name.length>=2?await withDeadline(signal=>resolveCompany({company:name},boundedFetcher(fetcher,signal),store),3500).catch(()=>null):null);
      }
      if(!company?.domain)return null;
      if(!companies.has(company.domain))companies.set(company.domain,{...await companyPattern(store,company.domain),...company});
      return {...companies.get(company.domain),...company};
    })());
    return resolutions.get(key);
  }
  const contacts=[],profiles=data.profiles.map(p=>({...p,company:data.companyOverride?data.company:p.company || fallbackCompany || '',emailStatus:'unverified',source:'Browser-visible LinkedIn profile',companyAssociation:p.companyAssociation || 'Automatically resolved employer; review source evidence',sources:[{url:data.sourceUrl},{url:p.linkedinUrl}]}));
  const healths=data.preparedHealthByDomain || (data.preparedHealth?.domain?{[data.preparedHealth.domain]:data.preparedHealth}:{});
  for(let offset=0;offset<profiles.length;offset+=4){
    const batch=await Promise.allSettled(profiles.slice(offset,offset+4).map(async person=>{
      const company=await companyFor(person);let contact;
      if(worker)contact=await resolvePersonEmail(person,company,{store,config:effective,fetcher,allowCredits:data.allowCredits,allowSearch:data.allowSearch,domainHealth:healths[company?.domain]});
      else {const known=person.directEmail?observedEmail(person,person.directEmail,person.emailEvidence):person;contact=company?suggestCorporateEmails([known],company)[0]:{...known,email:known.email || '',emailStatus:'unverified'};}
      const resolved=contact.resolvedCompany || company;if(resolved?.domain)companies.set(resolved.domain,resolved);
      return {...contact,company:contact.company || resolved?.name || person.company || '',resolvedCompany:resolved,companyDomain:resolved?.domain || contact.companyDomain || '',requiresDomainReview:contact.requiresDomainReview ?? (!resolved || resolved.requiresDomainReview===true),domainVerification:healths[contact.companyDomain || resolved?.domain] || contact.domainVerification};
    }));
    for(let i=0;i<batch.length;i++)contacts.push(batch[i].status==='fulfilled'?batch[i].value:{...profiles[offset+i],email:'',emailStatus:'unverified',requiresDomainReview:true,lookupWarnings:['Automatic lookup could not complete. This profile is saved for a later retry.']});
  }
  const pending=contacts.map((c,i)=>({c,i})).filter(({c})=>!c.domainVerification || c.domainVerification.status==='unknown'),checked=await checkContactDomains(pending.map(({c})=>c),{lookupMx,fetcher});for(let i=0;i<pending.length;i++)contacts[pending[i].i]=checked[i];
  return {company:companies.size===1?[...companies.values()][0]:null,companies:[...companies.values()],contacts};
}
async function persistBrowserPeople({company,companies=[],contacts},store,data) {
  await store.refresh();let added=0;const contactIds=[];
  for(const incoming of contacts){
    const resolved=incoming.resolvedCompany || (company?.domain===incoming.companyDomain?company:null),domain=resolved?.domain || incoming.companyDomain || '';
    const previous=store.state.contacts.find(c=>c.linkedinUrl===incoming.linkedinUrl && (!c.companyDomain || c.companyDomain===domain) || incoming.email && c.email?.toLowerCase()===incoming.email.toLowerCase());if(previous?.suppressed || previous?.isDemo)continue;
    const {resolvedCompany,...safeIncoming}=incoming,invalid=incoming.domainVerification?.status==='invalid',record={...safeIncoming,source:'Browser-visible LinkedIn profile',email:incoming.email || '',emailStatus:invalid?'invalid':incoming.emailStatus || 'unverified',requiresDomainReview:!domain || incoming.requiresDomainReview===true || resolved?.requiresDomainReview===true,companyDomain:domain,company:incoming.company || resolved?.name || '',isDemo:false,suppressed:false,createdAt:now()};
    let contact=previous;if(!contact){contact={...record,id:id()};store.state.contacts.push(contact);added++;}
    else if(contact.emailStatus!=='verified'){const held=contact.emailStatus==='invalid' && contact.email===record.email && record.emailStatus!=='verified'?{emailStatus:contact.emailStatus,verification:contact.verification}:{};Object.assign(contact,record,{id:contact.id,createdAt:contact.createdAt},held);}
    contactIds.push(contact.id);
  }
  const unique=new Map([...companies,...contacts.map(c=>c.resolvedCompany),company].filter(c=>companyDomain(c?.domain)).map(c=>[c.domain,c]));
  for(const company of unique.values())await observeCompanyEmails(store,company,contacts.filter(c=>c.companyDomain===company.domain));
  await store.save();await activity(store,'contacts',`${data.company || 'LinkedIn page'}: ${contactIds.length} browser profiles saved; ${contacts.filter(c=>c.emailStatus==='verified').length} verified mailboxes.`,added);return {added,contactIds,domain:unique.size===1?[...unique.keys()][0]:null,status:'Imported for review'};
}
export async function importBrowserContacts(task,store,config={},fetcher=fetch,dependencies={}) {
  const prepared=await prepareBrowserPeople(task.payload,store,config,fetcher,{...dependencies,worker:true});return persistBrowserPeople(prepared,store,task.payload);
}
function browserContactRows(ids,store){return ids.map(id=>store.state.contacts.find(c=>c.id===id)).filter(c=>c && !c.suppressed).map(({id,name,title,email,emailStatus,alternateEmails,company,companyDomain,domainVerification,requiresDomainReview,emailInferred,emailObserved,emailEvidence,emailPattern,emailResolution,confidence,confidenceMeaning,lookupWarnings,verification})=>({id,name,title,email,emailStatus,alternateEmails:alternateEmails || [],company,companyDomain,domainVerification,requiresDomainReview,emailInferred,emailObserved,emailEvidence,emailPattern,emailResolution,confidence,confidenceMeaning,lookupWarnings,verification}));}
export async function browserContactContext(company,store,config={},fetcher=fetch,evidence={}){
  const name=text(company,150),effective=await effectiveProviderConfig(store,config),available={mailboxConfigured:!!(effective.HUNTER_API_KEY || effective.PROSPEO_API_KEY || effective.GETPROSPECT_API_KEY || effective.APOLLO_API_KEY),searchConfigured:!!(effective.SERPER_API_KEY || effective.TAVILY_API_KEY)};if(name.length<2)return {...available,company:'',domain:'',requiresDomainReview:true};
  const found=linkedInDomainEvidence({...evidence,company:name}) || await withDeadline(signal=>resolveCompany({company:name},boundedFetcher(fetcher,signal),store),3500).catch(()=>null);
  return {...available,company:name,domain:found?.domain || '',requiresDomainReview:!found || found.requiresDomainReview===true,source:found?.source || 'Automatic URL enrichment pending'};
}
export async function browserImportResult(taskId,store,queue,tokenId) {
  const task=await queue.get(taskId);if(!task || task.kind!=='contacts.browser-import' || tokenId && task.payload.tokenId!==tokenId)fail('Browser import not found.',404);
  const contacts=browserContactRows(task.result?.contactIds || task.payload.preparedContactIds || [],store);
  return {taskId:task.id,status:task.status,count:task.payload.profiles.length,contacts,message:task.status==='failed'?'This import could not complete. Retry from the profile or check Contacts in Veloce.':task.status==='completed'?`${contacts.length} profile(s) processed. Mailbox verification is separate from domain MX.`:'Checking company domain and email suggestions in the background.'};
}
