import {findHunterEmail} from '../providers/contacts/hunter.mjs';
import {findProspeoEmail,findEmailByLinkedInUrlWithProspeo} from '../providers/contacts/prospeo.mjs';
import {matchPersonByLinkedInUrl} from '../providers/contacts/apollo.mjs';
import {findGetProspectEmail} from '../providers/contacts/getprospect.mjs';
import {searchPersonEmailEvidence,searchLinkedInEmployer} from '../providers/contacts/serper-xray.mjs';
import {resolveCompany} from '../providers/contacts/company.mjs';
import {verifyWorkEmail} from '../providers/contacts/verification.mjs';
import {suggestCorporateEmails} from './company-patterns.mjs';
import {providerCall} from './provider-budget.mjs';
import {boundedFetcher,withDeadline} from '../providers/deadline.mjs';
import {emailValid,hash,now,safeUrl} from '../domain.mjs';
import {profileURL} from '../../shared/contact-discovery.mjs';

const generic=/^(?:careers?|hr|info|support|jobs|contact|talent|hello|admin)@/i;
const letters=value=>String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z]/g,'');
export function publishedPersonEmail(person,domain,results){
  const parts=String(person.name || '').trim().split(/\s+/),f=letters(parts[0]),l=letters(parts.at(-1));if(parts.length<2 || !f || !l)return null;
  const locals=new Set([f,`${f}.${l}`,`${f[0]}${l}`,`${f}_${l}`,`${f}${l[0]}`,`${l}.${f}`,`${f}${l}`,`${f}-${l}`]);
  const evidence=[];
  for(const result of results.slice(0,20)){
    const body=`${result.title || ''} ${result.snippet || ''}`,reference=safeUrl(result.link || result.url);
    // A name match plus an unmasked, name-compatible email on the same source.
    // A directory result or a mask alone cannot identify the person's mailbox.
    const words=body.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' '),name=person.name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    if(!reference || !(` ${words} `).includes(` ${name} `))continue;
    for(const match of body.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)){
      const email=match[0].toLowerCase();if(!emailValid(email) || generic.test(email) || email.split('@')[1]!==domain || !locals.has(email.split('@')[0]))continue;
      evidence.push({email,reference});
    }
  }
  const unique=[...new Map(evidence.map(e=>[e.email,e])).values()];return unique.length===1?unique[0]:null;
}
export function observedEmail(person,email,evidence){
  return {...person,email,emailStatus:'unverified',emailInferred:false,emailObserved:true,emailEvidence:{...evidence,mailboxVerified:false},confidence:null,confidenceMeaning:'Published address evidence; mailbox deliverability has not been checked',verification:{provider:evidence.kind==='published-web'?'Published Web Match':'LinkedIn Direct',status:'unverified',at:now(),reference:evidence.reference,result:'Address was published for this profile. Source evidence does not verify current mailbox deliverability.'}};
}
export async function resolvePersonEmail(person,company,{store,config={},fetcher=fetch,allowCredits=false,allowSearch=false,domainHealth}={}){
  const warnings=[],day=new Date().toISOString().slice(0,10),identity=hash([person.name?.toLowerCase(),profileURL(person.linkedinUrl)]);
  let resolvedCompany=company?.domain?company:null,domain=resolvedCompany?.domain;
  const call=(provider,key,fn)=>providerCall(store,`person-email-v2:${hash(config[{Hunter:'HUNTER_API_KEY',Prospeo:'PROSPEO_API_KEY',Apollo:'APOLLO_API_KEY',GetProspect:'GETPROSPECT_API_KEY',Serper:'SERPER_API_KEY',Tavily:'TAVILY_API_KEY'}[provider]] || '')}:${day}:${key.startsWith('url:')?'':domain || ''}:${identity}:${key}`,provider,['Serper','Tavily'].includes(provider)?Math.min(500,Number(config.CONTACT_SEARCH_DAILY_LIMIT)||100):Math.min(100,Number(config.CONTACT_API_DAILY_LIMIT)||20),fn);
  let candidate=person.directEmail && emailValid(person.directEmail)?observedEmail(person,person.directEmail,person.emailEvidence || {kind:'linkedin-profile-text',reference:person.linkedinUrl}):null;
  if(!domain && allowCredits && profileURL(person.linkedinUrl)){
    const names=String(person.name || '').trim().split(/\s+/);
    for(const [provider,key,lookup] of [['Prospeo',config.PROSPEO_API_KEY,()=>findEmailByLinkedInUrlWithProspeo({linkedinUrl:person.linkedinUrl,apiKey:config.PROSPEO_API_KEY},fetcher)],['Apollo',config.APOLLO_API_KEY,()=>matchPersonByLinkedInUrl({linkedinUrl:person.linkedinUrl,firstName:names[0],lastName:names.at(-1),company:person.company,apiKey:config.APOLLO_API_KEY},fetcher)]]){
      if(!key)continue;
      try{const found=await call(provider,`url:${person.linkedinUrl}`,lookup);if(!found)continue;
        if(found.companyDomain){domain=found.companyDomain;resolvedCompany={domain,name:found.company || person.company || '',source:found.companyDomainSource,reference:person.linkedinUrl,requiresDomainReview:found.requiresDomainReview===true};}
        if(!candidate || found.emailStatus==='verified')candidate={...person,...found,name:person.name,title:person.title || found.title,linkedinUrl:person.linkedinUrl,emailInferred:false,emailObserved:false,emailEvidence:{kind:'person-finder',provider,reference:person.linkedinUrl,mailboxVerified:found.emailStatus==='verified'},confidence:null,confidenceMeaning:'LinkedIn URL provider match; consult the explicit mailbox status'};
        if(candidate.emailStatus==='verified')break;
      }catch(error){warnings.push(error.status?error.message:`${provider} LinkedIn URL lookup could not complete.`);}
    }
  }
  if(!domain && allowSearch){
    const found=await searchLinkedInEmployer(person,config,{fetcher,call:(provider,fn,key)=>call(provider,key,fn)});warnings.push(...found.warnings);
    if(found.company){resolvedCompany=await withDeadline(signal=>resolveCompany({company:found.company},boundedFetcher(fetcher,signal),store),3500).catch(()=>null);domain=resolvedCompany?.domain;if(resolvedCompany)resolvedCompany={...resolvedCompany,name:found.company,employmentReference:found.reference};}
  }
  if(!candidate && domain && allowSearch){
    const found=await searchPersonEmailEvidence(person,domain,config,{fetcher,call:(provider,fn,key)=>call(provider,key,fn)});
    warnings.push(...found.warnings);
    const published=publishedPersonEmail(person,domain,found.results);
    if(published)candidate=observedEmail(person,published.email,{kind:'published-web',reference:published.reference});
  }
  if(allowCredits){
    if(candidate && candidate.emailStatus!=='verified' && config.HUNTER_API_KEY){
      try{const checked=await call('Hunter',`verify:${candidate.email}`,()=>withDeadline(signal=>verifyWorkEmail(candidate.email,config,boundedFetcher(fetcher,signal),undefined,domainHealth?.domain===candidate.email.split('@')[1]?domainHealth:undefined),22000));Object.assign(candidate,checked);if(checked.emailStatus==='verified')candidate.emailEvidence={...candidate.emailEvidence,mailboxVerified:true};}
      catch(error){warnings.push(error.status?error.message:'Mailbox verification could not complete. The published address remains unverified.');}
    }
    // Exact-person lookup precedes any attempt to verify a guessed permutation.
    const hasPublishedAddress=!!candidate;
    if(domain && candidate?.emailStatus!=='verified')for(const [provider,key,finder,deadline] of [['Hunter',config.HUNTER_API_KEY,findHunterEmail,22000],['Prospeo',config.PROSPEO_API_KEY,findProspeoEmail,20000],['GetProspect',config.GETPROSPECT_API_KEY,findGetProspectEmail,95000]]){
      if(!key || provider==='Hunter' && hasPublishedAddress)continue;
      try{
        const found=await call(provider,'finder',()=>withDeadline(signal=>finder(person,domain,key,boundedFetcher(fetcher,signal)),deadline));
        if(found && found.emailStatus!=='invalid'){
          if(found.linkedinUrl && profileURL(found.linkedinUrl)!==profileURL(person.linkedinUrl))continue;
          if(candidate && found.emailStatus!=='verified' && candidate.email!==found.email)continue;
          candidate={...person,...found,name:person.name,title:person.title,linkedinUrl:person.linkedinUrl,emailInferred:false,emailObserved:false,emailEvidence:{kind:'person-finder',provider,reference:person.linkedinUrl,mailboxVerified:found.emailStatus==='verified'},confidence:null,confidenceMeaning:'Provider finder result; consult the explicit mailbox status'};
          if(found.emailStatus==='verified' || found.emailStatus==='catch-all')break;
        }
      }catch(error){warnings.push(error.status?error.message:`${provider} exact-person lookup could not complete.`);}
    }
  }
  const contact=resolvedCompany?suggestCorporateEmails([{...person,...candidate,company:resolvedCompany.name || candidate?.company || person.company || '',requiresDomainReview:resolvedCompany.requiresDomainReview===true}],resolvedCompany)[0]:candidate || {...person,email:'',emailStatus:'unverified'};
  if(candidate)Object.assign(contact,{confidence:candidate.confidence,confidenceMeaning:candidate.confidenceMeaning});
  return {...contact,company:resolvedCompany?.name || candidate?.company || person.company || '',resolvedCompany,lookupWarnings:[...new Set(warnings)].slice(0,4),emailResolution:candidate?.emailStatus==='verified'?'mailbox-verified':candidate?'source-address':domain?'candidate-only':'unresolved'};
}
