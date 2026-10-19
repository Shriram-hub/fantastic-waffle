import { remoteJSON } from "../http.mjs";
import { id, now, text, emailValid } from "../../domain.mjs";

export async function searchHunter(domain, key, limit = 3, fetcher = fetch) {
  const url = new URL("https://api.hunter.io/v2/domain-search");
  url.search = new URLSearchParams({domain,api_key:key,limit:String(limit),type:"personal"});
  const result = await remoteJSON(url.href, {}, fetcher);
  return (result.data?.emails || []).filter(p => emailValid(p.value || "") && /recruit|talent|people|founder|\bcto\b|engineering manager|head of engineering/i.test(p.position || ""))
    .slice(0,limit).map(p => ({id:id(),name:[p.first_name,p.last_name].filter(Boolean).join(" ") || "Hiring team",email:p.value.toLowerCase(),company:text(result.data.organization,150),title:text(p.position,150),
      emailStatus:"unverified",source:"Hunter",suppressed:false,isDemo:false,createdAt:now()}));
}
