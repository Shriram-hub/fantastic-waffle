import {text,safeUrl,hash} from '../domain.mjs';
import {candidateProfile} from './candidate-profile.mjs';
import {remoteJSON} from '../providers/http.mjs';
import {providerCall} from './provider-budget.mjs';
const norm=v=>String(v || '').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const escaped=v=>v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function sharedBackground(state) {
  const p=candidateProfile(state.profile);
  return [...p.education.map(e=>({kind:'school',name:e.institution})),...p.workExperience.map(e=>({kind:'employer',name:e.company}))].filter(e=>e.name?.trim().length>=4).filter((e,i,a)=>a.findIndex(v=>v.kind===e.kind && norm(v.name)===norm(e.name))===i).slice(0,8);
}
export function warmPeople(results,company,background) {
  return results.flatMap(r=>{
    const url=safeUrl(r.link);if(!url || !/^https:\/\/(?:[a-z]+\.)?linkedin\.com\/in\//i.test(url))return [];
    const header=text(r.title,250),snippet=text(r.snippet,1500),name=header.split(/\s[-–|]\s/)[0].trim();
    if(!name.includes(' ') || !norm(header).includes(norm(company)))return [];
    const signals=background.filter(b=>norm(snippet).includes(norm(b.name))).map(b=>{
      const entity=escaped(b.name),explicit=b.kind==='school' ? new RegExp(`(?:education\\s*[:–-]|studied at|attended|graduated from)\\s*${entity}(?:\\b|$)`,'i') : new RegExp(`(?:previously at|formerly at|past (?:company|employer)\\s*[:–-])\\s*${entity}(?:\\b|$)`,'i');
      return {...b,status:explicit.test(snippet) ? 'source-supported' : 'possible',quote:snippet,url,checkedAt:new Date().toISOString()};
    });
    return signals.length ? [{name,linkedinUrl:url,warmSignals:signals}] : [];
  }).slice(0,5);
}
export function warmHook(contact,state) {
  const known=sharedBackground(state),signal=(contact.warmSignals || []).find(s=>s.status==='source-supported' && s.url && s.quote && known.some(k=>k.kind===s.kind && norm(k.name)===norm(s.name)));
  if(!signal)return '';
  return signal.kind==='school' ? `I also studied at ${signal.name} and came across your profile while exploring ${contact.company}.` : `I previously worked at ${signal.name} and noticed that background on your public profile too.`;
}
export async function prioritizeWarmContacts(contacts,job,store,config={},fetcher=fetch,enabled=false) {
  const background=sharedBackground(store.state);
  if(!enabled || !config.SERPAPI_API_KEY || !background.length)return {contacts,people:[],warnings:[]};
  const url=new URL('https://serpapi.com/search.json'),terms=background.slice(0,4).map(b=>`"${text(b.name,120).replaceAll('"','')}"`).join(' OR ');
  url.search=new URLSearchParams({engine:'google',q:`site:linkedin.com/in "${text(job.company,100).replaceAll('"','')}" (${terms}) (recruiter OR manager OR analyst OR founder OR talent)`,num:'10',api_key:config.SERPAPI_API_KEY});
  try {
    const key=hash([job.company.toLowerCase(),background,Math.floor(Date.now()/(7*86400000))]);
    const data=await providerCall(store,`warm:${key}`,'SerpApi',Math.min(30,Math.max(1,Number(config.JOB_SEARCH_API_DAILY_LIMIT)||6)),()=>remoteJSON(url.href,{},fetcher,30000));
    const people=warmPeople(data.organic_results || [],job.company,background);
    const ranked=contacts.map(c=>{const p=people.find(p=>norm(p.name)===norm(c.name) || c.linkedinUrl && c.linkedinUrl.replace(/\/$/,'')===p.linkedinUrl.replace(/\/$/,''));return p ? {...c,warmSignals:p.warmSignals,linkedinUrl:p.linkedinUrl} : c;}).sort((a,b)=>Number((b.warmSignals || []).some(s=>s.status==='source-supported'))-Number((a.warmSignals || []).some(s=>s.status==='source-supported')));
    return {contacts:ranked,people,warnings:[]};
  } catch(e){return {contacts,people:[],warnings:[e.status ? e.message : 'Warm search is unavailable. Standard discovery continued.']};}
}
