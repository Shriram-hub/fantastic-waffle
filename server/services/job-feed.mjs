import {hash} from '../domain.mjs';
import {rankOpportunity} from './search-plan.mjs';
import {jobFreshness} from './job-freshness.mjs';
import {semanticJobHash} from './job-details.mjs';
export const compactRank=match=>({score:match.score,eligible:match.eligible,recommendable:match.recommendable,tier:match.tier,scope:match.scope,compact:true});
export const rankedMatch=(job,plan)=>job.discoveryMatch?.scope===plan.scope ? job.discoveryMatch : rankOpportunity(job,plan);
export function serializeFeedJob(job,plan,resumeHash) {
  const {detailCacheKey,detailSourceId,indexSkills,descriptionHash,...rest}=job;
  return {...rest,...jobFreshness(job),description:job.description?.slice(0,280) || '',descriptionTruncated:job.descriptionTruncated || (job.description?.length || 0)>280,semanticMatch:job.semanticMatch?.resumeHash===resumeHash && job.semanticMatch?.jobHash===semanticJobHash(job)?job.semanticMatch:null,match:rankOpportunity(job,plan)};
}
export function queryJobFeed(state,plan,options={}) {
  const q=String(options.q || '').toLowerCase().trim().slice(0,200),saved=new Set(state.applications.map(a=>a.jobId)),personalized=plan.personalized;
  const selected=state.jobs.filter(j=>!j.archived).filter(j=>!q || `${j.title} ${j.company} ${j.description || ''} ${(j.tags || []).join(' ')} ${(j.indexSkills || []).join(' ')}`.toLowerCase().includes(q)).filter(j=>!options.workMode || j.workMode===options.workMode).filter(j=>!options.source || j.source===options.source || j.sources?.some(s=>s.source===options.source)).filter(j=>options.firstMover!==true || jobFreshness(j).firstMover).map(job=>({job,match:rankedMatch(job,plan)})).filter(({job,match})=>options.view==='saved'?saved.has(job.id):options.view==='strong'?match.tier==='strong' && match.eligible:options.view==='adjacent'?match.tier==='adjacent':options.view==='foryou' && personalized?match.recommendable:true);
  selected.sort((a,b)=>(b.match.score || 0)-(a.match.score || 0) || (Date.parse(b.job.publishedAt)||0)-(Date.parse(a.job.publishedAt)||0));
  const offset=Math.max(0,Math.min(15000,Number(options.offset)||0)),limit=Math.max(1,Math.min(100,Number(options.limit)||20));
  return {jobs:selected.slice(offset,offset+limit).map(({job})=>serializeFeedJob(job,plan,hash(state.resume?.text))),total:selected.length,offset,limit};
}
export function bootstrapJobs(state,plan) {
  const pinned=new Set([...state.applications,...state.contacts,...state.campaigns,...(state.jobDocuments || []),...(state.jobPitches || [])].map(item=>item.jobId));
  const sorted=state.jobs.map(job=>({job,match:rankedMatch(job,plan)})).sort((a,b)=>Number(b.match.recommendable)-Number(a.match.recommendable) || Number(b.match.eligible)-Number(a.match.eligible) || (b.match.score || 0)-(a.match.score || 0));
  const selected=sorted.filter(({job},index)=>index<500 || pinned.has(job.id));
  return {jobs:selected.map(({job})=>serializeFeedJob(job,plan,hash(state.resume?.text))),jobFeed:{total:state.jobs.filter(j=>!j.archived).length,truncated:selected.length<state.jobs.length,sources:[...new Set(state.jobs.filter(j=>!j.archived).map(j=>j.source))].sort()}};
}
