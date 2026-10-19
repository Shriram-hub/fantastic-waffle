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
export async function searchApollo(query, key, fetcher = fetch) {
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
  const data = await remoteJSON(
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
  if (!key) fail("Set APOLLO_API_KEY on the server first.", 503);
  if (!contact.apolloId || contact.source !== "Apollo")
    fail("Select a contact found through Apollo search.");
  const data = await remoteJSON(
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
