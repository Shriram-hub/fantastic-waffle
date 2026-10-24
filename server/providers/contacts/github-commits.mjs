import {providerJSON} from './provider-http.mjs';
import {normalizeProviderContact} from './normalized.mjs';
import {companyDomain} from './company.mjs';
import {safeUrl} from '../../domain.mjs';
export async function githubCommitContacts(company,{fetcher=fetch,token='',limit=15}={}) {
  const domain=companyDomain(company.domain);if(!domain)return [];
  const headers={'User-Agent':'Veloce','Accept':'application/vnd.github+json',...(token?{Authorization:`Bearer ${token}`}:{})};
  const load=path=>providerJSON('GitHub',`https://api.github.com${path}`,{headers},fetcher,8000,[token]);
  let org=company.githubOrg;
  if(!org){const data=await load(`/search/users?q=${encodeURIComponent(`${company.name || domain} type:org`)}&per_page=3`);for(const item of data.items || []){if(!/^[\w-]{1,39}$/.test(item.login || ''))continue;const profile=await load(`/orgs/${item.login}`);try{if(companyDomain(new URL(/^https?:/.test(profile.blog || '')?profile.blog:`https://${profile.blog}`).hostname)===domain){org=item.login;break;}}catch{}}}
  if(!/^[\w-]{1,39}$/.test(org || ''))return [];
  // Validate even an explicitly supplied organization against its public site.
  const profile=await load(`/orgs/${org}`);try{if(companyDomain(new URL(/^https?:/.test(profile.blog || '')?profile.blog:`https://${profile.blog}`).hostname)!==domain)return [];}catch{return [];}
  const repos=await load(`/orgs/${org}/repos?type=public&sort=pushed&per_page=2`),results=await Promise.allSettled(repos.slice(0,2).filter(r=>!r.fork && !r.private).map(r=>/^[\w.-]{1,100}$/.test(r.name)?load(`/repos/${org}/${r.name}/commits?per_page=30`):[]));
  const contacts=[];
  for(const result of results)if(result.status==='fulfilled')for(const commit of result.value || [])for(const p of [commit.commit?.author,commit.commit?.committer]) {
    if(!p || /noreply|\[bot\]|dependabot|github-actions/i.test(`${p.name} ${p.email}`))continue;
    const c=normalizeProviderContact({name:p.name,email:p.email,title:'Public code contributor'},domain,'GitHub public commit',{verified:false,reference:safeUrl(commit.html_url)});if(c)contacts.push({...c,emailObserved:true});
  }
  return [...new Map(contacts.map(c=>[c.email,c])).values()].slice(0,limit);
}
