import {domainMailHealth} from './dns.mjs';
import { remoteJSON } from "../http.mjs";
import { fail, emailValid, now } from "../../domain.mjs";
import {contactProviderError} from './errors.mjs';
export async function checkEmailDomain(email, lookupMx, fetcher=fetch) {
  if (!emailValid(email)) fail("There is no valid work email to verify.");
  const domain = email.split("@")[1];
  const health=await domainMailHealth(domain,{lookupMx,fetcher});
  if(health.status==='invalid')return {emailStatus:'invalid',domainVerification:health,verification:{provider:health.provider,status:'invalid',at:now(),result:health.reason}};
  if(!health.hasMx)return {emailStatus:'unverified',domainVerification:health,verification:{provider:health.provider,status:'unverified',at:now(),result:health.reason}};
  return null; // MX is a domain precheck, never proof that a mailbox exists.
}
export async function verifyWorkEmail(email, config, fetcher = fetch, lookupMx,domainHealth) {
  const rejected = domainHealth?.hasMx ? null : await checkEmailDomain(email, lookupMx,fetcher);
  if (rejected) return rejected;
  if (!config.HUNTER_API_KEY)
    return rejected || {emailStatus:"unverified",verification:{provider:"DNS",status:"unverified",at:now(),result:"Mailbox verification requires a verification provider"}};
  const url = new URL("https://api.hunter.io/v2/email-verifier");
  url.search = new URLSearchParams({ email, api_key: config.HUNTER_API_KEY });
  let response;try{response=await remoteJSON(url.href,{},fetcher,30000);}catch(error){
    if(error.providerStatus===451)return {emailStatus:'invalid',suppressed:true,verification:{provider:'Hunter',status:'invalid',at:now(),result:'This address is excluded at its owner’s request.'}};
    throw contactProviderError('Hunter',error);
  }
  const data=response.data;
  if (!data)
    fail("The verification provider returned an unexpected response.", 502);
  const status =
    !data.accept_all && !data.webmail && !data.disposable && !data.block && data.status === "valid" && (!data.result || data.result === "deliverable")
      ? "verified"
      : data.status === "accept_all" || data.accept_all
        ? "catch-all"
        : data.status === "invalid"
          ? "invalid"
          : "unverified";
  return {
    emailStatus: status,
    verification: {
      provider: "Hunter",
      status,
      at: now(),
      result: data.result || null,
    },
  };
}
export function emailCandidates(first, last, domain) {
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain || "")) return [];
  const f=String(first || "").toLowerCase().replace(/[^a-z]/g,""), l=String(last || "").toLowerCase().replace(/[^a-z]/g,"");
  if (!f || !l) return [];
  return [`${f}@${domain}`,`${f}.${l}@${domain}`,`${f[0]}${l}@${domain}`].map(email => ({email,emailStatus:"unverified",source:"Unverified name pattern"}));
}
export function targetTitles(employees) {
  return Number(employees) > 0 && Number(employees) < 50
    ? ["Founder", "CTO", "VP Engineering", "Head of Talent"]
    : ["Technical Recruiter", "University Recruiter", "Engineering Manager"];
}
