import { randomBytes } from "node:crypto";
import { fail, hash, id, now, scoreJob, campaignFingerprint, previewCampaign, sampleEmail } from "../domain.mjs";
import { fetchJobs, canonicalJobKey, mergeJobListings } from "../providers/jobs/index.mjs";
import { generateSearchMatrix, draftAutopilotPitch } from "./ai.mjs";
import { getPolicy, savePolicy, profileScope, pipelineBlockers, activity, policyAllows } from "./autopilot-policy.mjs";
import { resumeHash } from "./resume-storage.mjs";
import { resolveCompany, companyDomain } from "../providers/contacts/company.mjs";
import { searchApollo, enrichApollo } from "../providers/contacts/apollo.mjs";
import { searchHunter } from "../providers/contacts/hunter.mjs";
import { checkEmailDomain, verifyWorkEmail, targetTitles } from "../providers/contacts/verification.mjs";
import { providerCall } from "./provider-budget.mjs";
import { queueCampaign } from "./outreach.mjs";
import boards from "../providers/jobs/boards.json" with { type: "json" };
import { discoverATSBoards } from "../providers/jobs/ats-search.mjs";
import {findPublicContacts} from '../providers/contacts/free-xray.mjs';

export const SWEEP_INTERVAL = 2 * 3600000;
export async function ensureSearchMatrix(store, config = {}, fetcher = fetch) {
  const row = await store.db.prepare("SELECT body FROM search_matrices WHERE id='current'").get();
  const existing = row && JSON.parse(row.body), s = store.state;
  const inputHash = hash({resume:resumeHash(s.resume),text:s.resume?.text || "",skills:s.profile.skills,interests:s.profile.interests,location:s.profile.location,workMode:s.profile.workMode});
  if (existing?.sourceHash === inputHash) return existing;
  const policy = await getPolicy(store);
  const matrix = await generateSearchMatrix(s,config,fetcher,store,policy.enabled && policy.scope === profileScope(s) && policy.useAI);
  await store.db.prepare("INSERT INTO search_matrices(id,body) VALUES('current',?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(JSON.stringify(matrix));
  store.state.discovery_queries={target_roles:matrix.target_roles,locations:matrix.locations,keywords:matrix.skills};
  await store.save();
  return matrix;
}
async function activePolicy(store, expectedId) {
  const p = await getPolicy(store);
  if (!p.enabled || p.id !== expectedId || p.scope !== profileScope(store.state)) return null;
  return p;
}
export async function scheduleAutopilot(store, queue, config = {}, clock = Date.now()) {
  await store.refresh();
  const p = await getPolicy(store);
  if (!p.enabled) return null;
  if (p.scope !== profileScope(store.state)) {
    await store.db.prepare("UPDATE autopilot_schedule SET next_run=? WHERE id='local'").run(clock+SWEEP_INTERVAL);
    return null;
  }
  const blockers = await pipelineBlockers(store, config, p);
  if (blockers.discovery.length) return null;
  await store.db.exec("BEGIN IMMEDIATE");
  try {
    await store.db.prepare("INSERT OR IGNORE INTO autopilot_schedule(id,next_run,cursor) VALUES('local',?,0)").run(clock);
    const row = await store.db.prepare("SELECT * FROM autopilot_schedule WHERE id='local'").get();
    if (row.next_run > clock) { await store.db.exec("COMMIT"); return null; }
    const task = await queue.enqueue("JOB_DISCOVERY_SWEEP", {policyId:p.id}, {dedupeKey:`discovery-${p.id}-${row.next_run}`});
    await store.db.prepare("UPDATE autopilot_schedule SET next_run=? WHERE id='local'").run(clock + SWEEP_INTERVAL);
    await store.db.exec("COMMIT"); return task;
  } catch(e) { await store.db.exec("ROLLBACK"); throw e; }
}
export function scoreDiscoveredJob(job, state, matrix, policy = {}) {
  if (job.isDemo || job.archived || !matrix.target_roles.length) return {score:0};
  if(job.expiresAt && (typeof job.expiresAt === 'number' ? job.expiresAt*1000 : Date.parse(job.expiresAt))<Date.now()) return {score:0};
  if (state.profile.workMode !== "Any" && state.profile.workMode && job.workMode !== state.profile.workMode) return {score:0};
  if(job.workMode !== "Remote" && state.profile.location && !job.location.toLowerCase().includes(state.profile.location.toLowerCase())) return {score:0};
  const senior=/\b(senior|staff|principal|lead|director|manager|head|vp)\b/i;
  if(senior.test(job.title) && !matrix.target_roles.some(r=>senior.test(r))) return {score:0};
  const restrictions=job.locationRestrictions || [];
  if(restrictions.length) {
    if(!policy.country) return {score:0};
    const countryName=new Intl.DisplayNames(['en'],{type:'region'}).of(policy.country);
    if(!restrictions.some(r=>[policy.country,countryName].some(c=>String(r).toLowerCase()===c.toLowerCase()))) return {score:0};
  }
  const roleScores = matrix.target_roles.map(role => scoreJob(job,{...state.profile,skills:matrix.skills,interests:[role]}));
  return {...roleScores.sort((a,b) => (b.score || 0)-(a.score || 0))[0],scope:profileScope(state),method:"keyword"};
}
async function updateRun(store, run, status, extra = {}) {
  run.status = status; Object.assign(run.body, extra);
  await store.db.prepare("UPDATE autopilot_runs SET status=?,policy_id=?,body=?,updated_at=? WHERE id=?")
    .run(status,run.policyId,JSON.stringify(run.body),Date.now(),run.id);
}
const decodeRun = row => row && ({id:row.id,jobId:row.job_id,policyId:row.policy_id,status:row.status,body:JSON.parse(row.body)});
export async function discoverJobs(task, store, queue, config = {}, fetcher = fetch) {
  const p = await activePolicy(store,task.payload.policyId);
  if (!p) return {status:"cancelled",reason:"Autopilot is paused or the profile/settings changed."};
  const matrix = await ensureSearchMatrix(store,config,fetcher);
  if (!matrix.target_roles.length) {
    await activity(store,"blocked","Add target roles or supported skills to build a search plan.");
    return {count:0,blocked:true};
  }
  const schedule = await store.db.prepare("SELECT cursor FROM autopilot_schedule WHERE id='local'").get();
  const cursor = schedule?.cursor || 0, selectedBoards = Array.from({length:Math.min(10,boards.length)},(_,i)=>boards[(cursor+i)%boards.length]);
  const customBoards = ["Greenhouse","Lever","Ashby"].flatMap(source => (store.state.settings[`${source.toLowerCase()}Boards`] || []).map(slug=>({source,slug})));
  if(p.useSearchAPI && config.SERPAPI_API_KEY) {
    try {
      const discovered=await providerCall(store,`ats-search:${matrix.target_roles[0]}:${new Date().toISOString().slice(0,10)}`,"SerpApi",p.maxContactLookupsPerDay,
        ()=>discoverATSBoards(matrix.target_roles[0],matrix.locations[0] || "",config,fetcher));
      customBoards.push(...discovered);
    } catch {await activity(store,"provider","Optional ATS search unavailable; public feeds and curated boards continue.");}
  }
  const sources = [{source:"Remotive",slug:"",ttl:6*3600000},{source:"Arbeitnow",slug:"",ttl:SWEEP_INTERVAL},
    ...Array.from({length:Math.min(3,matrix.target_roles.length)},(_,i)=>matrix.target_roles[(Math.floor(cursor/10)*3+i)%matrix.target_roles.length]).map(role=>({source:"Himalayas",slug:role,ttl:86400000})),
    ...[...new Map([...customBoards,...selectedBoards].map(b=>[`${b.source}:${b.slug}`,b])).values()].slice(0,20).map(b=>({...b,ttl:SWEEP_INTERVAL}))];
  let found = 0, failed = 0, queried = 0;
  const eligible = new Map();
  const indexed=await store.db.prepare("SELECT id FROM job_search_runs WHERE status='completed' ORDER BY created_at DESC LIMIT 1").get();
  if(indexed) {
    // Independent discovery owns the source schedule and source toggles. Outreach
    // consumes that index rather than re-fetching disabled or already cached feeds.
    sources.length=0;
    for(const job of store.state.jobs) if(scoreDiscoveredJob(job,store.state,matrix,p).score>=p.minimumMatchScore) eligible.set(job.id,job);
  }
  for (const source of sources) {
    await store.refresh();
    if (!await activePolicy(store,p.id)) return {status:"cancelled"};
    const key = `${source.source}:${source.slug}`, previous = store.state.syncs[key];
    let jobs;
    if (previous?.ok && Date.now()-Date.parse(previous.at)<source.ttl) {
      jobs = store.state.jobs.filter(j => !j.archived && (j.sources || [{source:j.source,board:j.board || ""}]).some(s=>s.source===source.source && s.board===source.slug));
    } else {
      try {
        jobs = await fetchJobs(source.source,source.slug,fetcher,config,source.source === "Himalayas" ? source.slug : matrix.target_roles[0]);
        queried++;
        const catalog = boards.find(b => b.source===source.source && b.slug===source.slug);
        if (catalog) jobs = jobs.map(j => ({...j,company:catalog.company,companyDomain:catalog.companyDomain,companyDomainSource:"provider"}));
        await store.refresh();
        // Keep the feed focused; failed providers never archive existing jobs.
        const scored = jobs.map(j=>({...j,autopilotMatch:scoreDiscoveredJob(j,store.state,matrix,p)})).filter(j => j.autopilotMatch.score >= p.minimumMatchScore).slice(0,100);
        const before = new Set(store.state.jobs.map(canonicalJobKey));
        // Keep every live listing in the discovery feed; only the outreach
        // pipeline uses the higher score threshold.
        store.state.jobs = mergeJobListings(store.state.jobs,jobs.map(job=>({...job,autopilotMatch:scoreDiscoveredJob(job,store.state,matrix,p)})),source.source,source.slug);
        found += scored.filter(j=>!before.has(canonicalJobKey(j))).length;
        store.state.syncs[key] = {ok:true,at:now(),count:jobs.length,matched:scored.length};
        await store.save(); jobs = scored;
      } catch(error) {
        failed++; await activity(store,"provider",`${source.source}${source.slug ? ` / ${source.slug}` : ""} unavailable; other sources continue.`); continue;
      }
    }
    for (const job of jobs) {
      if (scoreDiscoveredJob(job,store.state,matrix,p).score < p.minimumMatchScore) continue;
      const saved = store.state.jobs.find(j=>canonicalJobKey(j)===canonicalJobKey(job));
      if (saved) eligible.set(saved.id,saved);
    }
  }
  await store.refresh();
  if (!await activePolicy(store,p.id)) return {status:"cancelled"};
  await store.db.prepare("INSERT INTO autopilot_schedule(id,next_run,cursor) VALUES('local',?,?) ON CONFLICT(id) DO UPDATE SET cursor=excluded.cursor").run(Date.now()+SWEEP_INTERVAL,(cursor+10)%Math.max(boards.length,1));
  let queued = 0;
  for (const j of [...eligible.values()].sort((a,b)=>scoreDiscoveredJob(b,store.state,matrix,p).score-scoreDiscoveredJob(a,store.state,matrix,p).score).slice(0,30)) {
    const latest=store.state.jobs.find(job=>job.id===j.id);
    if(latest) latest.autopilotMatch=scoreDiscoveredJob(latest,store.state,matrix,p);
    if (!store.state.applications.some(a=>a.jobId===j.id)) store.state.applications.push({id:id(),jobId:j.id,stage:"Saved",notes:"Discovered by Autopilot",createdAt:now(),updatedAt:now(),isDemo:false,history:[{stage:"Saved",at:now(),source:"Autopilot discovery"}]});
  }
  await store.save();
  for (const j of [...eligible.values()].slice(0,30)) {
    const runId = hash(["autopilot-job-v1",canonicalJobKey(j)]);
    let run = decodeRun(await store.db.prepare("SELECT * FROM autopilot_runs WHERE id=?").get(runId));
    if (run && (["queued","completed"].includes(run.status) || run.policyId===p.id && (run.status==="review" || run.body.retryAfter>Date.now()))) continue;
    if (!run) {
      run={id:runId,jobId:j.id,policyId:p.id,status:"discovered",body:{createdAt:now()}};
      await store.db.prepare("INSERT OR IGNORE INTO autopilot_runs(id,job_id,policy_id,status,body,updated_at) VALUES(?,?,?,?,?,?)").run(run.id,run.jobId,p.id,run.status,JSON.stringify(run.body),Date.now());
    } else {run.policyId=p.id; await updateRun(store,run,"discovered");}
    await queue.enqueue("AUTO_ENRICH_COMPANY",{runId,policyId:p.id},{dedupeKey:`enrich-${runId}-${p.id}-${Math.floor(Date.now()/SWEEP_INTERVAL)}`}); queued++;
  }
  await activity(store,"discovery",`Discovered ${found} new matching roles; ${queued} company lookups queued${failed ? `; ${failed} sources unavailable` : ""}.`,found);
  return {count:found,queued,queried,failed};
}
async function contactCoolingDown(store,email,campaignId="") {
  return !!await store.db.prepare("SELECT task_id FROM outreach_send_log WHERE contact_email=? AND campaign_id!=? AND status IN ('queued','sending','accepted','unknown') AND updated_at>?").get(email.toLowerCase(),campaignId,Date.now()-30*86400000);
}
export async function enrichCompany(task,store,queue,config = {},fetcher = fetch,lookupMx,contactPages) {
  const p=await activePolicy(store,task.payload.policyId),run=decodeRun(await store.db.prepare("SELECT * FROM autopilot_runs WHERE id=?").get(task.payload.runId));
  if (!p || !run || run.policyId!==p.id || ["review","queued","completed"].includes(run.status)) return {status:"cancelled"};
  const j=store.state.jobs.find(j=>j.id===run.jobId);
  if (!j || j.archived) return {status:"cancelled"};
  try {
    const blockers=await pipelineBlockers(store,config,p);
    if (blockers.contacts.length) fail(blockers.contacts[0],503);
    const company=await resolveCompany(j,fetcher,store);
    if (!company) fail(`Company domain for ${j.company} is ambiguous or unavailable. No contact lookup was made.`,409);
    const otherRuns=await store.db.prepare("SELECT id,body FROM autopilot_runs WHERE status IN ('review','queued','completed') AND updated_at>?").all(Date.now()-7*86400000);
    if(otherRuns.some(r=>r.id!==run.id && JSON.parse(r.body).domain===company.domain)) fail(`Another ${j.company} role already has outreach in this week's pipeline.`,409);
    await store.db.prepare("INSERT INTO companies(domain,name,body) VALUES(?,?,?) ON CONFLICT(domain) DO UPDATE SET body=excluded.body").run(company.domain,j.company,JSON.stringify(company));
    const period=Math.floor(Date.now()/(7*86400000)), call=(key,provider,fn)=>providerCall(store,`${period}:${key}`,provider,p.maxContactLookupsPerDay,fn);
    let candidates=store.state.contacts.filter(c=>!c.isDemo && !c.suppressed && c.emailStatus==='verified' && (c.companyDomain===company.domain || c.email?.split('@')[1]===company.domain)).slice(0,p.contactsPerCompany), warnings=[];
    if(candidates.length<p.contactsPerCompany && p.allowContactCredits && config.APOLLO_API_KEY) {
      try {
        const titles=[...targetTitles(j.employeeCount),"CTO","Founder","Head of People"].slice(0,6).join(",");
        const people=await call(`search:${company.domain}`,"Apollo",()=>searchApollo({domain:company.domain,titles,limit:p.contactsPerCompany},config.APOLLO_API_KEY,fetcher));
        for(const person of people.slice(0,p.contactsPerCompany)) {
          try {candidates.push({...person,...await call(`enrich:${person.apolloId}`,"Apollo",()=>enrichApollo(person,config.APOLLO_API_KEY,fetcher))});}
          catch {warnings.push("An Apollo enrichment was held or unavailable.");}
        }
      } catch {warnings.push("Apollo unavailable; trying configured Hunter fallback.");}
    }
    if(candidates.filter(c=>c.email && c.emailStatus==="verified").length<p.contactsPerCompany && p.allowContactCredits && config.HUNTER_API_KEY) {
      try {
        const fallback=await call(`domain:${company.domain}`,"Hunter",()=>searchHunter(company.domain,config.HUNTER_API_KEY,p.contactsPerCompany,fetcher));
        candidates.push(...fallback);
      } catch {warnings.push('Hunter unavailable or at its budget limit; public contacts remain available.');}
    }
    if(p.freeContactFallback && candidates.filter(c=>c.email && c.emailStatus==='verified').length<p.contactsPerCompany) {
      candidates.push(...await findPublicContacts(j,company,{config,fetcher,pages:contactPages,allowSearch:p.useSearchAPI && p.allowContactCredits,call:fn=>call(`xray:${company.domain}`,'SerpApi',fn)}));
    }
    const unique=[...new Map(candidates.filter(c=>c.email && !sampleEmail(c.email)).map(c=>[c.email.toLowerCase(),c])).values()].slice(0,p.contactsPerCompany);
    const contactIds=[];
    for(const candidate of unique) {
      if(companyDomain(candidate.email.split("@")[1])!==company.domain) continue;
      if(candidate.organizationDomain && companyDomain(candidate.organizationDomain)!==company.domain) continue;
      if(await contactCoolingDown(store,candidate.email)) continue;
      const dns=await checkEmailDomain(candidate.email,lookupMx);
      if(dns) Object.assign(candidate,dns);
      else if(candidate.emailStatus!=='verified' && p.allowContactCredits && config.HUNTER_API_KEY) {
        try {Object.assign(candidate,await call(`verify:${candidate.email}`,"Hunter",()=>verifyWorkEmail(candidate.email,config,fetcher,lookupMx)));} catch {warnings.push('Mailbox verification unavailable; this contact stays unverified.');}
      }
      // Provider-verified corporate emails can be used without Hunter. MX alone cannot verify a guessed address.
      await store.refresh();
      if(!await activePolicy(store,p.id)) return {status:"cancelled"};
      const old=store.state.contacts.find(c=>c.email?.toLowerCase()===candidate.email.toLowerCase());
      if(old?.suppressed) continue;
      let c=old;
      if(!c) {c={...candidate,jobId:j.id,companyDomain:company.domain,company:j.company};store.state.contacts.push(c);}
      else if(c.isDemo) continue;
      else if(candidate.emailStatus==='verified') Object.assign(c,candidate,{id:c.id});
      Object.assign(c,{jobId:j.id,companyDomain:company.domain});
      if(c.emailStatus==='verified') contactIds.push(c.id);await store.save();
    }
    if(!contactIds.length) fail("No verified corporate contacts were available. Public or guessed candidates stay in Contacts for verification; no email was queued.",409);
    await updateRun(store,run,"enriched",{domain:company.domain,contactIds,warnings});
    await queue.enqueue("AUTO_DRAFT_PERSONALIZED_EMAIL",{runId:run.id,policyId:p.id},{dedupeKey:`draft-${run.id}-${p.id}`});
    await activity(store,"contacts",`Found ${contactIds.length} verified contacts for ${j.company}'s ${j.title} role.`,contactIds.length);
    return {count:contactIds.length};
  } catch(e) {
    const reason=e.status ? e.message : "Company lookup could not complete. Check provider access.";
    await updateRun(store,run,"blocked",{reason,retryAfter:Date.now()+SWEEP_INTERVAL});
    await activity(store,"blocked",`${j.company}: ${reason}`);
    return {blocked:true,reason};
  }
}
export async function draftPitches(task,store,queue,config = {},fetcher = fetch) {
  const p=await activePolicy(store,task.payload.policyId),run=decodeRun(await store.db.prepare("SELECT * FROM autopilot_runs WHERE id=?").get(task.payload.runId));
  if(!p || !run || run.policyId!==p.id || !["enriched","drafting"].includes(run.status)) return {status:"cancelled"};
  const job=store.state.jobs.find(j=>j.id===run.jobId);
  if(!job || job.archived) return {status:"cancelled"};
  const campaignIds=[];
  for(const contactId of run.body.contactIds) {
    const contact=store.state.contacts.find(c=>c.id===contactId);
    if(!contact || contact.suppressed || contact.emailStatus!=="verified" || await contactCoolingDown(store,contact.email)) continue;
    const campaignId=`auto-${hash([run.id,p.id,contact.email]).slice(0,40)}`;
    let campaign=store.state.campaigns.find(c=>c.id===campaignId);
    if(!campaign) {
      let resumeURL="",resumeShare=null;
      if(p.resumeMode==="link") {
        const token=randomBytes(32).toString("base64url"), expires=Date.now()+7*86400000;
        await store.db.prepare("INSERT INTO public_resumes(id,resume_hash,expires) VALUES(?,?,?)").run(hash(token),resumeHash(store.state.resume),expires);
        resumeURL=`${String(config.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/,"")}/r/${token}`;
        resumeShare={id:hash(token),expires};
      }
      const draft=await draftAutopilotPitch(store.state,job,contact,resumeURL,p,config,fetcher,store);
      await store.refresh();
      if(!await activePolicy(store,p.id)) return {status:"cancelled"};
      campaign={id:campaignId,name:`${job.company} · ${job.title}`,jobId:job.id,contactIds:[contact.id],subject:draft.subject,body:draft.body,
        attachResume:p.resumeMode==="attachment",resumeShare,accountId:p.accountId || null,deliveries:[],createdAt:now(),status:"Awaiting review",
        sequence:p.followup ? {enabled:true,afterBusinessDays:4,body:`Hi {{first_name}}, just following up on my note about the ${job.title.replace(/[{}\r\n]/g," ")} opening. I would appreciate any guidance on the hiring process. Thank you.`} : {enabled:false},
        autopilot:{policyId:p.id,runId:run.id,domain:run.body.domain,method:draft.method},evidence:draft.evidence};
      store.state.campaigns.push(campaign);await store.save();
    }
    campaignIds.push(campaign.id);
    if(p.approvalMode==="automatic" && !campaign.deliveries.length) await approvePreparedCampaign(campaign,store,queue,config,p);
  }
  await updateRun(store,run,p.approvalMode==="automatic" ? "queued" : "review",{campaignIds});
  await activity(store,p.approvalMode==="automatic" ? "queued" : "review",`${campaignIds.length} personalized pitches for ${job.company} ${p.approvalMode==="automatic" ? "queued for business hours" : "ready for review"}.`,campaignIds.length);
  return {count:campaignIds.length};
}
async function approvePreparedCampaign(c,store,queue,config,p,inTransaction=false) {
  if(!await policyAllows(store,c)) fail("Autopilot settings or profile changed. Save settings and run discovery again.",409);
  if(c.resumeShare?.expires<Date.now()+86400000) fail("This résumé link is near expiry. Generate a fresh draft before sending.",409);
  const previewId=id(),preview=previewCampaign(c,store.state);
  store.state.previews[previewId]={campaignId:c.id,fingerprint:campaignFingerprint(c,store.state),expires:Date.now()+600000};
  return queueCampaign(c,{approved:true,previewId,confirmCount:preview.messages.length},store,queue,config,{inTransaction});
}
export async function autopilotStatus(store,config = {}) {
  const p=await getPolicy(store),row=await store.db.prepare("SELECT body FROM search_matrices WHERE id='current'").get();
  const blockers=await pipelineBlockers(store,config,p);
  if(p.enabled && p.scope!==profileScope(store.state)) blockers.discovery.push("Your profile or résumé changed. Review and save Autopilot settings to resume.");
  const review=store.state.campaigns.filter(c=>c.autopilot?.policyId===p.id && !c.deliveries.length && c.status==="Awaiting review");
  const outcomes=await store.db.prepare('SELECT status,count(*) AS count FROM outreach_send_log GROUP BY status').all();
  const domains=Number((await store.db.prepare('SELECT count(*) AS count FROM companies').get()).count);
  const contactCounts=store.state.contacts.filter(c=>!c.isDemo).reduce((counts,c)=>{const key=/Apollo/i.test(c.source) ? 'apollo' : /Hunter/i.test(c.source) ? 'hunter' : /Public|pattern/i.test(c.source) ? 'public' : 'other';counts[key]++;return counts;},{apollo:0,hunter:0,public:0,other:0});
  const funnel={jobs:store.state.jobs.filter(j=>!j.isDemo && !j.archived).length,highMatches:store.state.jobs.filter(j=>!j.archived && (j.discoveryMatch?.score || j.autopilotMatch?.score || 0)>=p.minimumMatchScore).length,domains,contacts:contactCounts,scheduled:Number(outcomes.find(r=>r.status==='queued')?.count || 0),sent:Number(outcomes.find(r=>r.status==='accepted')?.count || 0)};
  return {policy:p,funnel,matrix:row ? JSON.parse(row.body) : null,schedule:await store.db.prepare("SELECT * FROM autopilot_schedule WHERE id='local'").get() || null,
    blockers,reviewCount:review.length,activity:await store.db.prepare("SELECT * FROM autopilot_activity ORDER BY at DESC LIMIT 30").all(),
    runs:(await store.db.prepare("SELECT * FROM autopilot_runs ORDER BY updated_at DESC LIMIT 30").all()).map(decodeRun),
    lookupsToday:Number((await store.db.prepare("SELECT count(*) AS count FROM provider_requests WHERE day=?").get(new Date().toISOString().slice(0,10))).count),
    heldLookups:await store.db.prepare("SELECT id,provider,status,created_at FROM provider_requests WHERE status='held' OR (status='started' AND created_at<?) ORDER BY created_at DESC LIMIT 20").all(Date.now()-10*60000),
    schedulerConfigured:!!config.AUTOPILOT_CRON_SECRET};
}
export async function retryHeldLookups(data,store,queue) {
  const p=await getPolicy(store);
  if(data.approved!==true || !Array.isArray(data.ids) || !data.ids.length || data.ids.length>20) fail("Confirm provider usage was checked before retrying 1–20 held requests.");
  if(!p.enabled || !p.allowContactCredits || p.scope!==profileScope(store.state)) fail("Enable and review the current Autopilot policy first.",409);
  await store.db.exec("BEGIN IMMEDIATE");
  try {
    for(const requestId of [...new Set(data.ids)]) {
      const old=await store.db.prepare("SELECT status,created_at FROM provider_requests WHERE id=?").get(String(requestId));
      if(!old || old.status!=="held" && !(old.status==="started" && old.created_at<Date.now()-10*60000)) fail("A provider request changed. Refresh before retrying.",409);
      // Preserve the original reservation in the budget/audit history.
      await store.db.prepare("UPDATE provider_requests SET id=?,status='reconciled' WHERE id=?").run(`${requestId}:held:${id()}`,String(requestId));
    }
    for(const row of await store.db.prepare("SELECT * FROM autopilot_runs WHERE status='blocked'").all()) {
      const run=decodeRun(row);run.policyId=p.id;
      await updateRun(store,run,"discovered",{retryAfter:0});
      await queue.enqueue("AUTO_ENRICH_COMPANY",{runId:run.id,policyId:p.id},{dedupeKey:`reconciled-${run.id}-${id()}`});
    }
    await store.db.exec("COMMIT");
  } catch(e) {await store.db.exec("ROLLBACK");throw e;}
  await activity(store,"provider","Owner approved retrying held provider lookups after checking usage.");
  return {count:data.ids.length};
}
export async function reviewAutopilot(store) {
  const p=await getPolicy(store),campaigns=store.state.campaigns.filter(c=>c.autopilot?.policyId===p.id && c.status==="Awaiting review" && !c.deliveries.length);
  const messages=campaigns.map(c=>({campaignId:c.id,jobId:c.jobId,company:c.name,method:c.autopilot.method,sequence:c.sequence,attachment:c.attachResume ? store.state.resume?.name : null,...previewCampaign(c,store.state).messages[0]}));
  return {messages,fingerprint:hash(campaigns.map(c=>campaignFingerprint(c,store.state)))};
}
export async function approveReview(data,store,queue,config) {
  const batch=await reviewAutopilot(store),p=await getPolicy(store);
  if(!p.enabled || p.approvalMode!=="review") fail("Enable review mode before approving a batch.",409);
  if(data.approved!==true || !batch.messages.length || data.confirmCount!==batch.messages.length || data.fingerprint!==batch.fingerprint) fail("The review queue changed. Review the current messages and approve their count.",409);
  await store.db.exec("BEGIN IMMEDIATE");
  try {
    for(const message of batch.messages) await approvePreparedCampaign(store.state.campaigns.find(c=>c.id===message.campaignId),store,queue,config,p,true);
    await store.db.exec("COMMIT");
  } catch(e) {await store.db.exec("ROLLBACK");throw e;}
  await activity(store,"queued",`${batch.messages.length} reviewed pitches queued for business hours.`,batch.messages.length);
  return {count:batch.messages.length};
}
export { getPolicy, savePolicy };
