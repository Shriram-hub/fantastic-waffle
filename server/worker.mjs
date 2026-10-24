import {recoverBounceAlternative} from './services/bounce-recovery.mjs';
import {probeCompany,fetchCompanyJobs} from './services/company-explorer.mjs';
import {workerHeartbeat} from './services/worker-health.mjs';
import {effectiveProviderConfig} from './services/provider-config.mjs';
import {discoverBulkBatch} from './services/bulk-harvest.mjs';
import {scheduleCatalog,importWorkspaceCatalog,rescoreCatalog} from './services/job-catalog.mjs';
import {syncDirectories} from './providers/jobs/directory.mjs';
import {buildSearchPlan} from './services/search-plan.mjs';
import { resumeHash, hydrateResume, persistResume } from "./services/resume-storage.mjs";
import { pathToFileURL } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { openConfiguredStore } from "./store-config.mjs";
import { taskQueue } from "./queue.mjs";
import { fetchJobs, mergeJobListings } from "./providers/jobs/index.mjs";
import { parseResumeAsync } from "./resume.mjs";
import { enrichApollo } from "./providers/contacts/apollo.mjs";
import { verifyWorkEmail } from "./providers/contacts/verification.mjs";
import {discoverCompanyTask} from './services/contact-discovery.mjs';
import {providerCall} from './services/provider-budget.mjs';
import {getPolicy} from './services/autopilot-policy.mjs';
import {buildJobDocuments} from './services/job-documents.mjs';
import {deliverAlert} from './services/notifications.mjs';
import {sendNative} from './providers/mail/native.mjs';
import {buildJobPitch} from './services/job-pitch.mjs';
import {importBrowserContacts} from './services/browser-contacts.mjs';
import {inboxActions} from './services/inbox-actions.mjs';
import {buildInterviewPrep} from './services/career.mjs';
import { extractStructuredResume, extractCandidateProfile, generateIcebreaker, classifyInboxAI, embedTexts, cosineSimilarity, factPreservingTailor } from "./services/ai.mjs";
import {candidateFromText,saveCandidate} from './services/candidate-profile.mjs';
import { syncMailbox, watchMailbox } from "./providers/mail/inbox.mjs";
import { ingestMessage, shouldClassify, scheduleMailboxSync } from "./services/inbox.mjs";
import { deliverTask } from "./services/outreach.mjs";
import { scheduleAutopilot, ensureSearchMatrix, discoverJobs, enrichCompany, draftPitches } from "./services/autopilot.mjs";
import {scheduleDiscovery,discoverBatch,getSearchConfig} from './services/discovery.mjs';
import {verifyBoard} from './providers/jobs/registry.mjs';
import {hydrateJobDetail,semanticJobHash} from './services/job-details.mjs';
import { fail, hash, now } from "./domain.mjs";
export function handlers(store,queue,config={},fetcher=fetch,dependencies={}) {
  const registry=providerHandlers(store,queue,config,fetcher,dependencies);
  return Object.fromEntries(Object.keys(registry).map(kind=>[kind,async task=>providerHandlers(store,queue,await effectiveProviderConfig(store,config),fetcher,dependencies)[kind](task)]));
}
function providerHandlers(store, queue, config = {}, fetcher = fetch, dependencies = {}) {
  const find = (values, id) => {
    const v = values.find(v => v.id === id);
    if (!v) fail("The target record no longer exists.", 404);
    return v;
  };
  async function inboxSync(accountId) {
    const result = await syncMailbox(accountId, store, config, fetcher);
    const unclassified = (await store.db.prepare("SELECT id,body FROM inbox_messages WHERE account_id=?").all(accountId)).filter(row => !JSON.parse(row.body).classifiedAt);
    for (const row of unclassified) await queue.enqueue("inbox.classify", {
      messageId: row.id
    }, {
      dedupeKey: `classify-${row.id}`
    });
    if (result.more) await queue.enqueue("inbox.sync", {
      accountId
    }, {
      dedupeKey: `continue-${accountId}-${Date.now()}`
    });
    return {
      count: unclassified.length,
      more: result.more
    };
  }
  return {
    async 'company.probe'(task){return probeCompany(task,store,queue,config,fetcher,dependencies);},
    async 'company.jobs'(task){return fetchCompanyJobs(task,store,queue,config,fetcher,dependencies);},
    async 'contacts.bounce-recover'(task){return recoverBounceAlternative(task,store,config,fetcher,dependencies.lookupMx);},
    async 'contacts.browser-import'(task){return importBrowserContacts(task,store,config,fetcher,dependencies);},
    async 'job.auto-pitch'(task){return buildJobPitch(task,store,queue,config,fetcher,dependencies);},
    async 'mail.test-send'(task) {
      const a=await store.db.prepare('SELECT id,email,metadata FROM mail_accounts WHERE id=?').get(task.payload.accountId);if(!a)return {status:'cancelled'};
      let result;
      try{result=await sendNative({to:a.email,subject:'Veloce connection test',body:'Your connected mailbox can send through Veloce. This test was requested from Connections and sent only to your own address.',messageKey:task.id},a.id,store,config,null,fetcher);}
      catch(error){result={status:'failed',error:error.status ? error.message : 'Mailbox connection failed. Reconnect OAuth in Connections.'};}
      const row=await store.db.prepare('SELECT metadata FROM mail_accounts WHERE id=?').get(a.id);if(row){const meta=JSON.parse(row.metadata);meta.connectionTests={...meta.connectionTests,send:{at:now(),...result}};await store.db.prepare('UPDATE mail_accounts SET metadata=? WHERE id=?').run(JSON.stringify(meta),a.id);}
      return result;
    },
    async 'mail.test-inbox'(task) {
      let result;
      try{result={status:'completed',...await inboxSync(task.payload.accountId),at:now()};}
      catch(error){result={status:'failed',at:now(),error:error.status ? error.message : 'Inbox connection failed. Reconnect OAuth in Connections.'};}
      const row=await store.db.prepare('SELECT metadata FROM mail_accounts WHERE id=?').get(task.payload.accountId);if(row){const meta=JSON.parse(row.metadata);meta.connectionTests={...meta.connectionTests,inbox:result};await store.db.prepare('UPDATE mail_accounts SET metadata=? WHERE id=?').run(JSON.stringify(meta),task.payload.accountId);}
      return result;
    },
    async 'alert.send'(task){return deliverAlert(task,store,config,fetcher);},
    async 'documents.build'(task){return buildJobDocuments(task,store,queue,config,fetcher);},
    async 'career.prep'(task){return buildInterviewPrep(task,store,queue,config,fetcher);},
    async 'contacts.discover'(task){return discoverCompanyTask(task,store,queue,config,fetcher,dependencies);},
    async 'contacts.bulk'(task){return discoverBulkBatch(task,store,queue,config,fetcher,dependencies);},
    async 'catalog.import'(){return importWorkspaceCatalog(store,buildSearchPlan(store.state,await getSearchConfig(store)),config);},
    async 'catalog.rescore'(task){return rescoreCatalog(task,store,queue,buildSearchPlan(store.state,await getSearchConfig(store)));},
    async 'directory.sync'(task){return syncDirectories(store,queue,fetcher,task.id);},
    async 'profile.import'(task) {
      const parsed=await parseResumeAsync(await hydrateResume(task.payload.file,store,config));
      await store.refresh();
      saveCandidate(store.state.profile,candidateFromText(parsed.resume.text),{source:task.payload.source});
      await store.save();await scheduleDiscovery(store,queue,config,true);
      if(task.payload.useAI && parsed.resume.text && config.LLM_API_KEY && config.LLM_MODEL) await queue.enqueue('profile.extract',{text:parsed.resume.text,source:task.payload.source},{dedupeKey:`profile-${hash(parsed.resume.text)}-${task.id}`});
      return {status:'Needs review',warning:parsed.warning};
    },
    async 'profile.extract'(task) {
      if(task.payload.resumeHash && resumeHash(store.state.resume)!==task.payload.resumeHash) return {status:'cancelled'};
      const source=task.payload.text || store.state.resume?.text || '';
      if(!source) fail('No readable profile text was found.');
      const output=await extractCandidateProfile(source,config,fetcher,store);
      await store.refresh();
      if(task.payload.resumeHash && resumeHash(store.state.resume)!==task.payload.resumeHash) return {status:'cancelled'};
      saveCandidate(store.state.profile,output,{source:task.payload.source || 'Résumé AI extraction'});
      if(task.payload.resumeHash) store.state.resume.structuredStatus='Needs review';
      await store.save();await ensureSearchMatrix(store,config,fetcher);await scheduleDiscovery(store,queue,config,true);
      return {status:'Needs review',experience:output.workExperience.length,education:output.education.length};
    },
    async 'boards.verify'(task) {return verifyBoard(task,store,fetcher);},
    async 'jobs.discover'(task) {return discoverBatch(task,store,queue,config,fetcher);},
    async "JOB_DISCOVERY_SWEEP"(task) { return discoverJobs(task,store,queue,config,fetcher); },
    async "AUTO_ENRICH_COMPANY"(task) { return enrichCompany(task,store,queue,config,fetcher,dependencies.lookupMx,dependencies.contactPages); },
    async "AUTO_DRAFT_PERSONALIZED_EMAIL"(task) { return draftPitches(task,store,queue,config,fetcher); },
    async "jobs.sync"(task) {
      const {
          source,
          board = ""
        } = task.payload,
        s = store.state,
        key = `${source}:${board}`;
      const old = s.syncs[key];
      if (old?.ok && Date.now() - Date.parse(old.at) < (source === "Remotive" ? 6 * 3600000 : 60000)) return {
        cached: true,
        count: old.count
      };
      const jobs = await fetchJobs(source, board, fetcher, config, s.profile.interests?.join(" ") || "");
      await store.refresh();
      store.state.jobs = mergeJobListings(store.state.jobs, jobs, source, board);
      store.state.syncs[key] = {
        ok: true,
        count: jobs.length,
        at: now()
      };
      await store.save();
      return {
        count: jobs.length
      };
    },
    async "resume.parse"(task) {
      const r = store.state.resume;
      if (!r || resumeHash(r) !== task.payload.resumeHash) return {
        status: "cancelled"
      };
      const result = await parseResumeAsync(await hydrateResume(r, store, config));
      await store.refresh();
      if (!store.state.resume || resumeHash(store.state.resume) !== task.payload.resumeHash) return {
        status: "cancelled"
      };
      const persisted = await persistResume(result.resume, store, config);
      await store.refresh();
      if (!store.state.resume || resumeHash(store.state.resume) !== task.payload.resumeHash) return {
        status: "cancelled"
      };
      Object.assign(store.state.resume, persisted, {
        suggestions: result.suggestions,
        warning: result.warning,
        parseStatus: "completed"
      });
      if (!persisted.base64) delete store.state.resume.base64;
      saveCandidate(store.state.profile,candidateFromText(persisted.text),{source:'Résumé text extraction'});
      await store.save();
      await ensureSearchMatrix(store,config,fetcher);
      await scheduleDiscovery(store,queue,config,true);
      if (config.LLM_API_KEY && config.LLM_MODEL && task.payload.structured) await queue.enqueue("resume.extract", {
        resumeHash: task.payload.resumeHash
      }, {
        dedupeKey: `extract-${task.payload.resumeHash}`
      });
      if(config.LLM_API_KEY && config.LLM_MODEL && task.payload.master && persisted.text) await queue.enqueue('profile.extract',{resumeHash:task.payload.resumeHash},{dedupeKey:`master-${task.payload.resumeHash}`});
      return {
        skills: result.suggestions.skills.length,
        warning: result.warning
      };
    },
    async "resume.extract"(task) {
      const r = store.state.resume;
      if (!r || resumeHash(r) !== task.payload.resumeHash) return {
        status: "cancelled"
      };
      const output = await extractStructuredResume(r, config, fetcher, store);
      await store.refresh();
      if (resumeHash(store.state.resume) !== task.payload.resumeHash) return {
        status: "cancelled"
      };
      store.state.resume.structured = output;
      store.state.resume.structuredStatus = "Needs review";
      await store.save();
      return {
        status: "Needs review"
      };
    },
    async "matching.compute"(task) {
      const s = store.state;
      if (!s.resume?.text) fail("Extract résumé text before semantic matching.");
      const jobs = await Promise.all(task.payload.jobIds.map(id => hydrateJobDetail(find(s.jobs,id),store)));
      if(jobs.some(j=>j.descriptionUnavailable || j.descriptionTruncated || !j.description))fail('Refresh source descriptions before computing semantic matches. No embedding request was made.');
      const sourceHashes=jobs.map(semanticJobHash);
      const input = [s.resume.text, ...jobs.map(j => `${j.title}\n${j.description}`)],
        vectors = await embedTexts(input, config, fetcher, store),
        resumeHash = hash(s.resume.text);
      await store.refresh();
      if (hash(store.state.resume?.text) !== resumeHash) return {
        status: "cancelled"
      };
      for (let i = 0; i < input.length; i++) await store.db.prepare("INSERT INTO embeddings(id,model,content_hash,vector) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET model=excluded.model,content_hash=excluded.content_hash,vector=excluded.vector").run(i === 0 ? "resume" : `job-${jobs[i - 1].id}`, config.EMBEDDING_MODEL, hash(input[i]), JSON.stringify(vectors[i]));
      for (let i = 0; i < jobs.length; i++) {
        const j = find(store.state.jobs, jobs[i].id);
        if (semanticJobHash(j) !== sourceHashes[i]) continue;
        j.semanticMatch = {
          score: Math.round(Math.max(0, Math.min(1, cosineSimilarity(vectors[0], vectors[i + 1]))) * 100),
          model: config.EMBEDDING_MODEL,
          resumeHash,
          jobHash: sourceHashes[i],
          at: now()
        };
      }
      await store.save();
      return {
        count: jobs.length
      };
    },
    async "resume.tailor"(task) {
      const s = store.state;
      if (!s.resume?.text) fail("Upload and parse a résumé first.");
      const version = factPreservingTailor(s.resume, await hydrateJobDetail(find(s.jobs,task.payload.jobId),store), s.profile);
      await store.db.prepare("INSERT INTO resume_versions(id,kind,body,created_at) VALUES(?,?,?,?)").run(version.id, version.kind, JSON.stringify(version), Date.now());
      return {
        versionId: version.id
      };
    },
    async "contact.enrich"(task) {
      const c = find(store.state.contacts, task.payload.contactId),
        result = await enrichApollo(c, config.APOLLO_API_KEY, fetcher);
      await store.refresh();
      const latest = find(store.state.contacts, c.id);
      if (result.email && store.state.contacts.some(x => x.id !== c.id && x.email === result.email)) fail("The enriched email already exists in this workspace.", 409);
      Object.assign(latest, result);
      await store.save();
      return {
        emailStatus: result.emailStatus
      };
    },
    async "contact.verify"(task) {
      const c = find(store.state.contacts, task.payload.contactId),
        email = c.email;
      if(c.suppressed || c.isDemo)return {status:'cancelled'};
      const effective=await effectiveProviderConfig(store,config),policy=await getPolicy(store),limit=Math.min(100,Math.max(1,Number(effective.CONTACT_API_DAILY_LIMIT) || policy.maxContactLookupsPerDay));
      const result=await providerCall(store,`contacts-v3:${hash(effective.HUNTER_API_KEY || '')}:${Math.floor(Date.now()/(7*86400000))}:verify:${email}`,'Hunter',limit,()=>verifyWorkEmail(email,effective,fetcher,dependencies.lookupMx));
      await store.refresh();
      const latest = find(store.state.contacts, c.id);
      if (latest.email !== email) return {
        status: "cancelled"
      };
      Object.assign(latest, result);
      await store.save();
      return {
        emailStatus: result.emailStatus
      };
    },
    async "contact.personalize"(task) {
      const c = find(store.state.contacts, task.payload.contactId),
        job = task.payload.jobId ? find(store.state.jobs, task.payload.jobId) : null,
        output = await generateIcebreaker(c, job, config, fetcher, store);
      await store.refresh();
      Object.assign(find(store.state.contacts, c.id), output);
      await store.save();
      return {
        status: "Needs review"
      };
    },
    async "inbox.sync"(task) {
      return inboxSync(task.payload.accountId);
    },
    async "inbox.classify"(task) {
      const row = await store.db.prepare("SELECT body FROM inbox_messages WHERE id=?").get(task.payload.messageId);
      if (!row) return {
        status: "cancelled"
      };
      const m = JSON.parse(row.body);
      if (shouldClassify(m, store.state) && store.state.settings.inboxUseAI && config.LLM_API_KEY && config.LLM_MODEL) m.aiClassification = await classifyInboxAI(m, config, fetcher, store);
      const result = await ingestMessage(m, store);
      await inboxActions(result.item || store.state.inbox.find(i=>i.messageId===m.id),store,queue,config);
      m.classifiedAt = now();
      await store.db.prepare("UPDATE inbox_messages SET body=? WHERE id=?").run(JSON.stringify(m), m.id);
      return {
        status: result.item?.status || "Ignored"
      };
    },
    async "inbox.watch"(task) {
      const result = await watchMailbox(task.payload.accountId, store, config, fetcher);
      await queue.enqueue("inbox.watch", task.payload, {
        runAt: Date.now() + 12 * 3600000,
        dedupeKey: `renew-${task.payload.accountId}-${result.watchExpires}`
      });
      return result;
    },
    async "campaign.send"(task) {
      return deliverTask(task, store, queue, config, fetcher);
    },
    async "campaign.followup"(task) {
      const accountId = task.payload.accountId;
      if (accountId === "resend") return {
        status: "cancelled",
        reason: "Follow-ups require a mailbox with reply detection."
      };
      await syncMailbox(accountId, store, config, fetcher);
      for (const row of await store.db.prepare("SELECT body FROM inbox_messages WHERE account_id=?").all(accountId)) {
        const m = JSON.parse(row.body);
        if (!m.classifiedAt) {
          await ingestMessage(m, store);
          await inboxActions(store.state.inbox.find(i=>i.messageId===m.id),store,queue,config);
          m.classifiedAt = now();
          await store.db.prepare("UPDATE inbox_messages SET body=? WHERE id=?").run(JSON.stringify(m), m.id);
        }
      }
      await store.refresh();
      return deliverTask(task, store, queue, config, fetcher);
    }
  };
}
export async function runOne(store, queue, registry, wantedId) {
  const task = await queue.claim(wantedId);
  if (!task) {await workerHeartbeat(store);return null;}
  await workerHeartbeat(store,'processing');
  const heartbeat = setInterval(() => Promise.allSettled([queue.heartbeat(task),workerHeartbeat(store,'processing')]), 20000);
  try {
    await queue.log(task.id, `Started ${task.kind}`);
    const result = await store.run(async () => {
      const handler = registry[task.kind];
      if (!handler) fail("Unknown task type.");
      return handler(task);
    });
    if (result?.status === "cancelled" && task.kind.startsWith("campaign.")) await store.run(async () => {
      await store.db.prepare("UPDATE outreach_send_log SET status='cancelled',updated_at=? WHERE task_id=? AND status='queued'").run(Date.now(),task.id);
      await store.db.prepare("UPDATE outreach_company_budget SET status='cancelled',updated_at=? WHERE task_id=? AND status='queued'").run(Date.now(),task.id);
      const c = store.state.campaigns.find(c => c.id === task.payload.campaignId),
        d = c?.deliveries.find(d => d.taskId === (task.payload.parentTaskId || task.id));
      if (d) {
        if (task.kind === "campaign.followup") {d.followupStatus = "cancelled";const step=d.followups?.find(s=>s.step===(task.payload.sequenceStep || 1));if(step)step.status="cancelled";}else d.status = "cancelled";
        d.error = result.reason || "Cancelled before sending.";
        c.status = "Needs attention";
        await store.save();
      }
    });
    await queue.finish(task, result);
    await queue.log(task.id, `Finished: ${result?.status || "completed"}`);
    return await queue.get(task.id);
  } catch (error) {
    if (task.kind.startsWith("campaign.")) {
      await store.db.prepare("UPDATE outreach_send_log SET status='unknown',updated_at=? WHERE task_id=? AND status='sending'").run(Date.now(),task.id);
      await store.db.prepare("UPDATE outreach_company_budget SET status='unknown',updated_at=? WHERE task_id=? AND status='queued'").run(Date.now(),task.id);
      try {
        await store.run(async () => {
          const c = store.state.campaigns.find(c => c.id === task.payload.campaignId),
            d = c?.deliveries.find(d => d.taskId === (task.payload.parentTaskId || task.id));
          if (d) {
            if (task.kind === "campaign.followup") {d.followupStatus = "unknown";const step=d.followups?.find(s=>s.step===(task.payload.sequenceStep || 1));if(step)step.status="unknown";}else d.status = "unknown";
            d.error = "Worker interrupted this outbound task. Reconcile with the provider.";
            c.status = "Needs attention";
            await store.save();
          }
        });
      } catch {}
    }
    await queue.finish(task, null, error);
    await queue.log(task.id, error.status ? error.message : "Worker failed; inspect its provider configuration and task data.");
    return await queue.get(task.id);
  } finally {
    clearInterval(heartbeat);
    await workerHeartbeat(store);
  }
}
export async function startWorker(config = process.env) {
  const store = await openConfiguredStore(config),
    queue = taskQueue(store),
    registry = handlers(store, queue, config);
  store.releaseRoot?.();
  if(config.JOB_CATALOG_ENABLED==='true')await store.run(async()=>scheduleCatalog(store,queue,config,buildSearchPlan(store.state,await getSearchConfig(store))));
  let stopping = false;
  let wake,wakeRequested=false;
  const onWake=message=>{if(message?.type==='queue-wake'){wakeRequested=true;wake?.();}};
  process.on('message',onWake);
  let redisWorker, connection, bull;
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => {
    stopping = true;
  });
  if (config.REDIS_URL) {
    const [{
      Queue,
      Worker
    }, {
      default: Redis
    }] = await Promise.all([import("bullmq"), import("ioredis")]);
    connection = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: null
    });
    bull = new Queue("orbit", {
      connection
    });
    redisWorker = new Worker("orbit", job => runOne(store, queue, registry, job.data.taskId), {
      connection,
      concurrency: 1
    });
    redisWorker.on("error", () => console.error("Redis worker connection error; durable tasks remain in the database."));
  }
  console.log(`Veloce worker started (${config.REDIS_URL ? "BullMQ + Redis" : `durable ${store.kind || "SQLite"} queue`}).`);
  let lastRecovery=0;
  while (!stopping) {
    if (Date.now()-lastRecovery>60000) {
      await queue.recover();
      try {
        // Cheap schedule probes avoid reloading the entire job index every minute.
        const due=await store.db.prepare("SELECT id FROM autopilot_schedule WHERE next_run<=? LIMIT 1").get(Date.now());
        const search=await store.db.prepare("SELECT id FROM job_search_config WHERE id='local'").get();
        const mailboxDue=await store.db.prepare("SELECT id FROM mail_accounts a WHERE NOT EXISTS (SELECT 1 FROM autopilot_schedule s WHERE s.id='mailbox:' || a.id AND s.next_run>?) LIMIT 1").get(Date.now());
        const stoppedSearch=await store.db.prepare('SELECT status FROM job_search_runs ORDER BY created_at DESC LIMIT 1').get(),stoppedRanking=await store.db.prepare("SELECT status FROM tasks WHERE kind='catalog.rescore' ORDER BY created_at DESC LIMIT 1").get();
        const interrupted=[stoppedSearch?.status,stoppedRanking?.status].some(status=>['failed','cancelled'].includes(status));
        if(due || !search || mailboxDue || interrupted) await store.run(async()=>{
          await scheduleDiscovery(store,queue,config);
          await scheduleAutopilot(store,queue,config);
          await scheduleMailboxSync(store,queue);
          await scheduleCatalog(store,queue,config,buildSearchPlan(store.state,await getSearchConfig(store)));
        });
      }
      catch { console.error("Autopilot schedule unavailable; durable work will be retried."); }
      lastRecovery=Date.now();
    }
    if (bull) {
      for (const row of await store.db.prepare("SELECT id,kind,status,run_at,attempts FROM tasks WHERE status='queued' ORDER BY run_at LIMIT 200").all()) await bull.add(row.kind, {
        taskId: row.id
      }, {
        jobId: `${row.id}-${row.attempts}-${row.run_at}`,
        delay: Math.max(0, row.run_at - Date.now()),
        removeOnComplete: true,
        removeOnFail: 100
      });
    } else await runOne(store, queue, registry);
    if(wakeRequested)wakeRequested=false;
    else await new Promise(resolve=>{const timer=setTimeout(done,store.kind==='postgres' ? 5000 : 1000);function done(){clearTimeout(timer);wake=null;resolve();}wake=done;});
  }
  if (redisWorker) await redisWorker.close();
  if (bull) await bull.close();
  if (connection) await connection.quit();
  process.off('message',onWake);
  await workerHeartbeat(store,'stopped');
  await store.close();
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await startWorker();
