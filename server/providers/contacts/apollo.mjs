import {
  fail,
  id,
  now,
  safeUrl,
  stripHtml,
  text,
  emailValid,
} from "../../domain.mjs";
import { remoteJSON } from "../http.mjs";
import {contactProviderError} from './errors.mjs';
import {providerKey} from '../../services/provider-config.mjs';
import {providerJSON} from './provider-http.mjs';
import {normalizeProviderContact} from './normalized.mjs';
import {companyDomain} from './company.mjs';
import {profileURL} from '../../../shared/contact-discovery.mjs';
async function apolloJSON(url,options,fetcher){try{return await remoteJSON(url,options,fetcher);}catch(error){throw contactProviderError('Apollo',error);}}
export async function matchPersonByLinkedInUrl({linkedinUrl,firstName,lastName,company,domain,apiKey},fetcher=fetch){
  const url=profileURL(linkedinUrl),key=providerKey(apiKey,'apollo');if(!url || !key)fail('Configure Apollo and use a public LinkedIn profile URL.',503);
  const result=await providerJSON('Apollo','https://api.apollo.io/api/v1/people/match',{method:'POST',headers:{'Content-Type':'application/json','X-Api-Key':key},body:JSON.stringify({linkedin_url:url,...(firstName?{first_name:firstName}:{}),...(lastName?{last_name:lastName}:{}),...(company?{organization_name:company}:{}),...(domain?{domain}:{}),reveal_personal_emails:false,reveal_phone_number:false,run_waterfall_email:false,run_waterfall_phone:false})},fetcher,20000,[key]),p=result.person;
  if(!p || ['none','low'].includes(result.match_confidence || p.match_confidence) || p.linkedin_url && profileURL(p.linkedin_url)!==url)return null;
  const corporate=p.organization || {},resolved=companyDomain(corporate.primary_domain || (p.email || '').split('@')[1]);
  const found=normalizeProviderContact({...p,company:corporate.name,linkedinUrl:url},resolved,'Apollo',{verified:p.email_status==='verified',catchAll:!!p.email_domain_catchall,reference:url});
  return found?{...found,requiresDomainReview:!corporate.primary_domain,company:corporate.name || '',companyDomainSource:'Apollo LinkedIn URL enrichment',companyAssociation:'Provider-matched current employer'}:null;
}
export async function searchApollo(query, key, fetcher = fetch) {
  key=providerKey(key,'apollo');
  if (!key) fail("Set APOLLO_API_KEY on the server to search Apollo.", 503);
  const domain = text(query.domain, 200).toLowerCase();
  if (
    domain &&
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)
  )
    fail("Enter a company domain such as example.com, without https://.");
  const titles = text(query.titles, 300)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);
  if (!domain && !titles.length)
    fail("Enter a company domain or a target job title.");
  const data = await apolloJSON(
    "https://api.apollo.io/api/v1/mixed_people/api_search",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": key },
      body: JSON.stringify({
        page: 1,
        per_page: Math.max(1, Math.min(25, Number(query.limit) || 25)),
        ...(domain ? { q_organization_domains_list: [domain] } : {}),
        ...(titles.length ? { person_titles: titles } : {}),
      }),
    },
    fetcher,
  );
  if (!Array.isArray(data.people))
    fail("Apollo returned an unexpected response.", 502);
  return data.people
    .map((p) => ({
      id: id(),
      apolloId: String(p.id || p.person_id || ""),
      name:
        text(
          [p.first_name, p.last_name || p.last_name_obfuscated]
            .filter(Boolean)
            .join(" "),
          150,
        ) || "Apollo contact",
      company: text(p.organization?.name || p.organization_name, 150),
      title: text(p.title, 150),
      email: "",
      emailStatus: "unverified",
      source: "Apollo",
      isDemo: false,
      suppressed: false,
      createdAt: now(),
    }))
    .filter((p) => p.apolloId);
}
export async function enrichApollo(contact, key, fetcher = fetch) {
  key=providerKey(key,'apollo');
  if (!key) fail("Set APOLLO_API_KEY on the server first.", 503);
  if (!contact.apolloId || contact.source !== "Apollo")
    fail("Select a contact found through Apollo search.");
  const data = await apolloJSON(
    "https://api.apollo.io/api/v1/people/match",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": key },
      body: JSON.stringify({
        id: contact.apolloId,
        reveal_personal_emails: false,
        reveal_phone_number: false,
      }),
    },
    fetcher,
  );
  if (!data.person) fail("Apollo did not find a matching person.", 404);
  const p = data.person;
  return {
    name: text(p.name, 150) || contact.name,
    email: emailValid(p.email || "") ? p.email.toLowerCase() : "",
    emailStatus: p.email_status === "verified" && !p.email_domain_catchall ? "verified" : "unverified",
    title: text(p.title, 150) || contact.title,
    company: text(p.organization?.name, 150) || contact.company,
    enrichedAt: now(),
    headline: text(p.headline, 500),
    companyDescription: text(p.organization?.short_description, 3000),
    organizationDomain: text(p.organization?.primary_domain, 200).toLowerCase(),
    verification: {provider:"Apollo",status:p.email_status === "verified" && !p.email_domain_catchall ? "verified" : "unverified",at:now()},
  };
}
