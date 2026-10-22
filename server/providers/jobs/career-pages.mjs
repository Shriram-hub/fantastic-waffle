import {page,robotsAllows} from '../contacts/public-pages.mjs';
import {withDeadline} from '../deadline.mjs';
import {extractSchemaOrgJobPostings} from './core.mjs';
import {boardFromURL} from './ats-search.mjs';
import {fail} from '../../domain.mjs';
export function careerURL(value) {
  try {const u=new URL(value);if(u.protocol!=='https:' || u.username || u.password || u.port || u.hostname.length>253 || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname) || u.hostname.endsWith('.local') || u.hostname.endsWith('.internal'))return '';u.hash='';return u.href.length<=1500?u.href:'';}catch{return '';}
}
export function careerLinks(html,url) {
  const links=[];for(const match of String(html).matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi))try{const link=careerURL(new URL(match[1].replaceAll('&amp;','&'),url).href);if(link && (boardFromURL(link) || /\/job[s]?\/|\/careers?\/.+/i.test(new URL(link).pathname)))links.push(link);}catch{}
  return [...new Set(links)].slice(0,40);
}
export async function crawlCareerPage(value,{load=page,signal}={}) {
  const url=careerURL(value);if(!url)fail('Use a public HTTPS career page URL without credentials or a custom port.');
  return withDeadline(async bounded=>{
    const u=new URL(url),domain=u.hostname;
    let robots;try{robots=await load(`${u.origin}/robots.txt`,domain,0,bounded);}catch(error){if(error.httpStatus===404)robots={text:''};else throw error;}
    if(!robotsAllows(robots.text,u.pathname))fail('This page does not allow automated discovery. Use its public ATS link instead.',422);
    const root=await load(url,domain,0,bounded),links=careerLinks(root.text,url),jobs=extractSchemaOrgJobPostings(root.text,root.url || url);
    if(!jobs.length) {
      const detail=links.filter(link=>new URL(link).hostname===domain && robotsAllows(robots.text,new URL(link).pathname)).slice(0,5);
      const result=await Promise.allSettled(detail.map(async link=>{const p=await load(link,domain,0,bounded);return extractSchemaOrgJobPostings(p.text,link);}));
      jobs.push(...result.filter(r=>r.status==='fulfilled').flatMap(r=>r.value));
    }
    return {jobs:[...new Map(jobs.map(j=>[j.id,j])).values()],boards:links.map(boardFromURL).filter(Boolean),reference:url};
  },7000,signal);
}
