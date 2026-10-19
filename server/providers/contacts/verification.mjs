import { Resolver } from "node:dns/promises";
import { remoteJSON } from "../http.mjs";
import { fail, emailValid, now } from "../../domain.mjs";
export async function verifyWorkEmail(email, config, fetcher = fetch, lookupMx) {
  if (!config.HUNTER_API_KEY)
    fail("Set HUNTER_API_KEY to verify work emails.", 503);
  if (!emailValid(email)) fail("There is no valid work email to verify.");
  const resolver = new Resolver({timeout:3000,tries:1});
  const domain = email.split("@")[1];
  let mx;
  try { mx = await (lookupMx || (name => resolver.resolveMx(name)))(domain); }
  catch(error) {
    // ENODATA can mean an implicit MX; let the verifier check A/AAAA fallback.
    if (error.code !== "ENODATA") {
      const status = error.code === "ENOTFOUND" ? "invalid" : "unverified";
      return {emailStatus:status,verification:{provider:"DNS",status,at:now(),result:error.code === "ENOTFOUND" ? "Domain does not exist" : "DNS temporarily unavailable"}};
    }
  }
  if (mx?.length && mx.every(record => !record.exchange || record.exchange === "."))
    return {emailStatus:"invalid",verification:{provider:"DNS",status:"invalid",at:now(),result:"Domain explicitly rejects email (null MX)"}};
  const url = new URL("https://api.hunter.io/v2/email-verifier");
  url.search = new URLSearchParams({ email, api_key: config.HUNTER_API_KEY });
  const response = await remoteJSON(url.href, {}, fetcher),
    data = response.data;
  if (!data)
    fail("The verification provider returned an unexpected response.", 502);
  const status =
    !data.accept_all && data.status === "valid" && data.result === "deliverable"
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
export function targetTitles(employees) {
  return Number(employees) > 0 && Number(employees) < 50
    ? ["Founder", "CTO", "VP Engineering", "Head of Talent"]
    : ["Technical Recruiter", "University Recruiter", "Engineering Manager"];
}
