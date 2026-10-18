import {
  resumeHash,
  hydrateResume,
  persistResume,
} from "./services/resume-storage.mjs";
import { pathToFileURL } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { openStore } from "./store.mjs";
import { taskQueue } from "./queue.mjs";
import { fetchJobs, mergeJobListings } from "./providers/jobs/index.mjs";
import { parseResume } from "./resume.mjs";
import { enrichApollo } from "./providers/contacts/apollo.mjs";
import { verifyWorkEmail } from "./providers/contacts/verification.mjs";
import {
  extractStructuredResume,
  generateIcebreaker,
  classifyInboxAI,
  embedTexts,
  cosineSimilarity,
  factPreservingTailor,
} from "./services/ai.mjs";
import { syncMailbox, watchMailbox } from "./providers/mail/inbox.mjs";
import { ingestMessage, shouldClassify } from "./services/inbox.mjs";
import { deliverTask } from "./services/outreach.mjs";
import { fail, hash, now } from "./domain.mjs";

export function handlers(store, queue, config = {}, fetcher = fetch) {
  const find = (values, id) => {
    const v = values.find((v) => v.id === id);
    if (!v) fail("The target record no longer exists.", 404);
    return v;
  };
  async function inboxSync(accountId) {
    const result = await syncMailbox(accountId, store, config, fetcher);
    const unclassified = store.db
      .prepare("SELECT id,body FROM inbox_messages WHERE account_id=?")
      .all(accountId)
      .filter((row) => !JSON.parse(row.body).classifiedAt);
    for (const row of unclassified)
      queue.enqueue(
        "inbox.classify",
        { messageId: row.id },
        { dedupeKey: `classify-${row.id}` },
      );
    if (result.more)
      queue.enqueue(
        "inbox.sync",
        { accountId },
        { dedupeKey: `continue-${accountId}-${Date.now()}` },
      );
    return { count: unclassified.length, more: result.more };
  }
  return {
    async "jobs.sync"(task) {
      const { source, board = "" } = task.payload,
        s = store.state,
        key = `${source}:${board}`;
      const old = s.syncs[key];
      if (
        old?.ok &&
        Date.now() - Date.parse(old.at) <
          (source === "Remotive" ? 6 * 3600000 : 60000)
      )
        return { cached: true, count: old.count };
      const jobs = await fetchJobs(
        source,
        board,
        fetcher,
        config,
        s.profile.interests?.join(" ") || "",
      );
      store.refresh();
      store.state.jobs = mergeJobListings(
        store.state.jobs,
        jobs,
        source,
        board,
      );
      store.state.syncs[key] = { ok: true, count: jobs.length, at: now() };
      store.save();
      return { count: jobs.length };
    },
    async "resume.parse"(task) {
      const r = store.state.resume;
      if (!r || resumeHash(r) !== task.payload.resumeHash)
        return { status: "cancelled" };
      const result = parseResume(await hydrateResume(r, store, config));
      store.refresh();
      if (
        !store.state.resume ||
        resumeHash(store.state.resume) !== task.payload.resumeHash
      )
        return { status: "cancelled" };
      const persisted = await persistResume(result.resume, store, config);
      store.refresh();
      if (
        !store.state.resume ||
        resumeHash(store.state.resume) !== task.payload.resumeHash
      )
        return { status: "cancelled" };
      Object.assign(store.state.resume, persisted, {
        suggestions: result.suggestions,
        warning: result.warning,
        parseStatus: "completed",
      });
      if (!persisted.base64) delete store.state.resume.base64;
      store.save();
      if (config.LLM_API_KEY && config.LLM_MODEL && task.payload.structured)
        queue.enqueue(
          "resume.extract",
          { resumeHash: task.payload.resumeHash },
          { dedupeKey: `extract-${task.payload.resumeHash}` },
        );
      return {
        skills: result.suggestions.skills.length,
        warning: result.warning,
      };
    },
    async "resume.extract"(task) {
      const r = store.state.resume;
      if (!r || resumeHash(r) !== task.payload.resumeHash)
        return { status: "cancelled" };
      const output = await extractStructuredResume(r, config, fetcher);
      store.refresh();
      if (resumeHash(store.state.resume) !== task.payload.resumeHash)
        return { status: "cancelled" };
      store.state.resume.structured = output;
      store.state.resume.structuredStatus = "Needs review";
      store.save();
      return { status: "Needs review" };
    },
    async "matching.compute"(task) {
      const s = store.state;
      if (!s.resume?.text)
        fail("Extract résumé text before semantic matching.");
      const jobs = task.payload.jobIds.map((id) => find(s.jobs, id));
      const input = [
          s.resume.text,
          ...jobs.map((j) => `${j.title}\n${j.description}`),
        ],
        vectors = await embedTexts(input, config, fetcher),
        resumeHash = hash(s.resume.text);
      store.refresh();
      if (hash(store.state.resume?.text) !== resumeHash)
        return { status: "cancelled" };
      for (let i = 0; i < input.length; i++)
        store.db
          .prepare(
            "INSERT INTO embeddings(id,model,content_hash,vector) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET model=excluded.model,content_hash=excluded.content_hash,vector=excluded.vector",
          )
          .run(
            i === 0 ? "resume" : `job-${jobs[i - 1].id}`,
            config.EMBEDDING_MODEL,
            hash(input[i]),
            JSON.stringify(vectors[i]),
          );
      for (let i = 0; i < jobs.length; i++) {
        const j = find(store.state.jobs, jobs[i].id);
        if (hash(`${j.title}\n${j.description}`) !== hash(input[i + 1]))
          continue;
        j.semanticMatch = {
          score: Math.round(
            Math.max(
              0,
              Math.min(1, cosineSimilarity(vectors[0], vectors[i + 1])),
            ) * 100,
          ),
          model: config.EMBEDDING_MODEL,
          resumeHash,
          jobHash: hash(input[i + 1]),
          at: now(),
        };
      }
      store.save();
      return { count: jobs.length };
    },
    async "resume.tailor"(task) {
      const s = store.state;
      if (!s.resume?.text) fail("Upload and parse a résumé first.");
      const version = factPreservingTailor(
        s.resume,
        find(s.jobs, task.payload.jobId),
        s.profile,
      );
      store.db
        .prepare(
          "INSERT INTO resume_versions(id,kind,body,created_at) VALUES(?,?,?,?)",
        )
        .run(version.id, version.kind, JSON.stringify(version), Date.now());
      return { versionId: version.id };
    },
    async "contact.enrich"(task) {
      const c = find(store.state.contacts, task.payload.contactId),
        result = await enrichApollo(c, config.APOLLO_API_KEY, fetcher);
      store.refresh();
      const latest = find(store.state.contacts, c.id);
      if (
        result.email &&
        store.state.contacts.some(
          (x) => x.id !== c.id && x.email === result.email,
        )
      )
        fail("The enriched email already exists in this workspace.", 409);
      Object.assign(latest, result);
      store.save();
      return { emailStatus: result.emailStatus };
    },
    async "contact.verify"(task) {
      const c = find(store.state.contacts, task.payload.contactId),
        email = c.email,
        result = await verifyWorkEmail(email, config, fetcher);
      store.refresh();
      const latest = find(store.state.contacts, c.id);
      if (latest.email !== email) return { status: "cancelled" };
      Object.assign(latest, result);
      store.save();
      return { emailStatus: result.emailStatus };
    },
    async "contact.personalize"(task) {
      const c = find(store.state.contacts, task.payload.contactId),
        job = task.payload.jobId
          ? find(store.state.jobs, task.payload.jobId)
          : null,
        output = await generateIcebreaker(c, job, config, fetcher);
      store.refresh();
      Object.assign(find(store.state.contacts, c.id), output);
      store.save();
      return { status: "Needs review" };
    },
    async "inbox.sync"(task) {
      return inboxSync(task.payload.accountId);
    },
    async "inbox.classify"(task) {
      const row = store.db
        .prepare("SELECT body FROM inbox_messages WHERE id=?")
        .get(task.payload.messageId);
      if (!row) return { status: "cancelled" };
      const m = JSON.parse(row.body);
      if (
        shouldClassify(m, store.state) &&
        store.state.settings.inboxUseAI &&
        config.LLM_API_KEY &&
        config.LLM_MODEL
      )
        m.aiClassification = await classifyInboxAI(m, config, fetcher);
      const result = ingestMessage(m, store);
      m.classifiedAt = now();
      store.db
        .prepare("UPDATE inbox_messages SET body=? WHERE id=?")
        .run(JSON.stringify(m), m.id);
      return { status: result.item?.status || "Ignored" };
    },
    async "inbox.watch"(task) {
      const result = await watchMailbox(
        task.payload.accountId,
        store,
        config,
        fetcher,
      );
      queue.enqueue("inbox.watch", task.payload, {
        runAt: Date.now() + 12 * 3600000,
        dedupeKey: `renew-${task.payload.accountId}-${result.watchExpires}`,
      });
      return result;
    },
    async "campaign.send"(task) {
      return deliverTask(task, store, queue, config, fetcher);
    },
    async "campaign.followup"(task) {
      const accountId = task.payload.accountId;
      if (accountId === "resend")
        return {
          status: "cancelled",
          reason: "Follow-ups require a mailbox with reply detection.",
        };
      await syncMailbox(accountId, store, config, fetcher);
      for (const row of store.db
        .prepare("SELECT body FROM inbox_messages WHERE account_id=?")
        .all(accountId)) {
        const m = JSON.parse(row.body);
        if (!m.classifiedAt) {
          ingestMessage(m, store);
          m.classifiedAt = now();
          store.db
            .prepare("UPDATE inbox_messages SET body=? WHERE id=?")
            .run(JSON.stringify(m), m.id);
        }
      }
      store.refresh();
      return deliverTask(task, store, queue, config, fetcher);
    },
  };
}
export async function runOne(store, queue, registry, wantedId) {
  const task = queue.claim(wantedId);
  if (!task) return null;
  const heartbeat = setInterval(() => queue.heartbeat(task), 30000);
  try {
    queue.log(task.id, `Started ${task.kind}`);
    const result = await store.run(async () => {
      const handler = registry[task.kind];
      if (!handler) fail("Unknown task type.");
      return handler(task);
    });
    if (result?.status === "cancelled" && task.kind.startsWith("campaign."))
      await store.run(() => {
        const c = store.state.campaigns.find(
            (c) => c.id === task.payload.campaignId,
          ),
          d = c?.deliveries.find(
            (d) => d.taskId === (task.payload.parentTaskId || task.id),
          );
        if (d) {
          if (task.kind === "campaign.followup") d.followupStatus = "cancelled";
          else d.status = "cancelled";
          d.error = result.reason || "Cancelled before sending.";
          c.status = "Needs attention";
          store.save();
        }
      });
    queue.finish(task, result);
    queue.log(task.id, `Finished: ${result?.status || "completed"}`);
    return queue.get(task.id);
  } catch (error) {
    if (task.kind.startsWith("campaign.")) {
      try {
        await store.run(() => {
          const c = store.state.campaigns.find(
              (c) => c.id === task.payload.campaignId,
            ),
            d = c?.deliveries.find(
              (d) => d.taskId === (task.payload.parentTaskId || task.id),
            );
          if (d) {
            if (task.kind === "campaign.followup") d.followupStatus = "unknown";
            else d.status = "unknown";
            d.error =
              "Worker interrupted this outbound task. Reconcile with the provider.";
            c.status = "Needs attention";
            store.save();
          }
        });
      } catch {}
    }
    queue.finish(task, null, error);
    queue.log(
      task.id,
      error.status
        ? error.message
        : "Worker failed; inspect its provider configuration and task data.",
    );
    return queue.get(task.id);
  } finally {
    clearInterval(heartbeat);
  }
}
export async function startWorker(config = process.env) {
  const store = openStore(config.DATA_DIR || "./data"),
    queue = taskQueue(store),
    registry = handlers(store, queue, config);
  let stopping = false;
  let redisWorker, connection, bull;
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => {
      stopping = true;
    });
  if (config.REDIS_URL) {
    const [{ Queue, Worker }, { default: Redis }] = await Promise.all([
      import("bullmq"),
      import("ioredis"),
    ]);
    connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
    bull = new Queue("orbit", { connection });
    redisWorker = new Worker(
      "orbit",
      (job) => runOne(store, queue, registry, job.data.taskId),
      { connection, concurrency: 1 },
    );
    redisWorker.on("error", () =>
      console.error(
        "Redis worker connection error; durable tasks remain in SQLite.",
      ),
    );
  }
  console.log(
    `Orbit worker started (${config.REDIS_URL ? "BullMQ + Redis" : "durable SQLite queue"}).`,
  );
  while (!stopping) {
    queue.recover();
    if (bull) {
      for (const row of store.db
        .prepare(
          "SELECT id,kind,status,run_at,attempts FROM tasks WHERE status='queued' ORDER BY run_at LIMIT 200",
        )
        .all())
        await bull.add(
          row.kind,
          { taskId: row.id },
          {
            jobId: `${row.id}-${row.attempts}-${row.run_at}`,
            delay: Math.max(0, row.run_at - Date.now()),
            removeOnComplete: true,
            removeOnFail: 100,
          },
        );
    } else await runOne(store, queue, registry);
    await pause(1000);
  }
  if (redisWorker) await redisWorker.close();
  if (bull) await bull.close();
  if (connection) await connection.quit();
  store.close();
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await startWorker();
