import {id,now,emailValid,safeUrl,text} from '../../domain.mjs';
import {companyDomain} from './company.mjs';
export function normalizeProviderContact(person,domain,provider,{verified=false,catchAll=false,reference=''}={}) {
  domain=companyDomain(domain);const email=String(person.email || '').trim().toLowerCase();
  if(!domain || !emailValid(email) || email.split('@')[1]!==domain || /\*/.test(email))return null;
  const name=text(person.fullName || person.full_name || person.name || [person.first_name,person.last_name].filter(Boolean).join(' '),150) || 'Company contact';
  const status=catchAll?'catch-all':verified?'verified':'unverified';
  return {id:id(),name,firstName:person.first_name || person.firstName || '',lastName:person.last_name || person.lastName || '',title:text(person.title || person.current_job_title || person.position,150) || 'Company contact',email,emailStatus:status,companyDomain:domain,company:text(person.company,150) || domain,source:provider,linkedinUrl:safeUrl(person.linkedin_url || person.linkedinUrl),sources:reference?[{url:reference}]:[],isDemo:false,suppressed:false,createdAt:now(),verification:{provider,status,at:now(),reference,result:verified?'Provider confirmed the corporate mailbox':'Source address only; mailbox verification is required'}};
}
