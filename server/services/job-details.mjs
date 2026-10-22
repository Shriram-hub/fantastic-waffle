import {gunzipSync} from 'node:zlib';
import {hash,containsTerm} from '../domain.mjs';
export const semanticJobHash=job=>hash(`${job.title}\n${job.descriptionHash ? `sha256:${job.descriptionHash}` : job.description}`);
export function compactIndexedJob(job,plan,cacheKey) {
  const description=String(job.description || ''),skills=(plan.skills || []).filter(s=>containsTerm(description.toLowerCase(),s.toLowerCase()));
  // Force a small independent string: V8 substring views can otherwise retain
  // the entire original provider description after the payload is released.
  return {...job,description:Buffer.from(description.slice(0,280)).toString('utf8'),descriptionLength:description.length,descriptionTruncated:description.length>280,descriptionHash:hash(description),indexSkills:skills,detailCacheKey:cacheKey,detailSourceId:job.id};
}
export async function hydrateJobDetail(job,store) {
  if(!job?.detailCacheKey || !job.descriptionTruncated)return job;
  const row=await store.db.prepare('SELECT body FROM job_source_cache WHERE id=?').get(job.detailCacheKey);
  if(!row)return job;
  try {
    const jobs=JSON.parse(gunzipSync(Buffer.from(row.body,'base64'),{maxOutputLength:16000000}).toString()),full=jobs.find(j=>j.id===(job.detailSourceId || job.id) || j.url===job.url);
    return full && (!job.descriptionHash || hash(full.description)===job.descriptionHash) ? {...job,description:full.description,descriptionTruncated:full.descriptionSourceTruncated===true} : job;
  }catch{return job;}
}
