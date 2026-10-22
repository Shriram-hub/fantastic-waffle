import { randomUUID } from "node:crypto";
import { fail } from "./domain.mjs";
export function postgresQueue(store) {
  const db = store.db;
  const decode = row => row && {
    ...row,
    payload: JSON.parse(row.payload),
    result: row.result ? JSON.parse(row.result) : null
  };
  async function enqueue(kind, payload, {
    runAt = Date.now(),
    dedupeKey = null,
    maxAttempts = 3
  } = {}) {
    const id = randomUUID(),
      at = Date.now();
    await db.prepare("INSERT OR IGNORE INTO tasks(id,kind,payload,run_at,dedupe_key,max_attempts,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(id, kind, JSON.stringify(payload), runAt, dedupeKey, maxAttempts, at, at);
    return decode(await db.prepare(dedupeKey ? "SELECT * FROM tasks WHERE dedupe_key=?" : "SELECT * FROM tasks WHERE id=?").get(dedupeKey || id));
  }
  async function reconcileExpired() {
    for (const task of await db.prepare("SELECT id,kind,payload FROM tasks WHERE status='unknown' AND lease_until IS NOT NULL AND kind IN ('campaign.send','campaign.followup','alert.send','mail.test-send')").all()) {
      await db.prepare("UPDATE outreach_send_log SET status='unknown',updated_at=? WHERE task_id=? AND status='sending'").run(Date.now(),task.id);
      const payload = JSON.parse(task.payload),
        row = await db.prepare("SELECT body FROM campaigns WHERE id=?").get(payload.campaignId || "");
      if (row) {
        const campaign = JSON.parse(row.body),
          delivery = campaign.deliveries.find(d => d.taskId === (payload.parentTaskId || task.id));
        if (delivery) {
          if (task.kind === "campaign.followup") delivery.followupStatus = "unknown";else delivery.status = "unknown";
          delivery.error = "Worker lease expired. Reconcile with the provider.";
          campaign.status = "Needs attention";
          await db.prepare("UPDATE campaigns SET status=?,body=? WHERE id=?").run(campaign.status, JSON.stringify(campaign), campaign.id);
        }
      }
      await db.prepare("UPDATE tasks SET lease_until=NULL WHERE id=?").run(task.id);
    }
  }
  async function claim(wantedId, clock=Date.now()) {
    const token=randomUUID();
    const where=wantedId ? "AND id=?" : "";
    return decode(await db.prepare(`UPDATE tasks SET status='running',attempts=attempts+1,lease_until=?,lease_token=?,updated_at=? WHERE id=(SELECT id FROM tasks WHERE status='queued' AND run_at<=? ${where} ORDER BY CASE WHEN kind='alert.send' THEN 0 ELSE 1 END,run_at,created_at LIMIT 1 FOR UPDATE SKIP LOCKED) AND status='queued' RETURNING *`).get(clock+120000,token,clock,clock,...(wantedId ? [wantedId] : []))) || null;
  }
  async function finish(task, result, error) {
    const clock = Date.now(),
      outbound = ["campaign.send", "campaign.followup", "alert.send", "mail.test-send"].includes(task.kind),
      status = error ? outbound ? "unknown" : task.attempts < task.max_attempts ? "queued" : "failed" : result?.status === "deferred" ? "queued" : result?.status === "failed" ? "failed" : result?.status === "unknown" ? "unknown" : result?.status === "cancelled" ? "cancelled" : "completed";
    const update = await db.prepare("UPDATE tasks SET status=?,result=?,error=?,run_at=?,lease_until=NULL,lease_token=NULL,updated_at=? WHERE id=? AND lease_token=? AND status='running'").run(status, result ? JSON.stringify(result) : null, error ? String(error.message).slice(0, 1000) : null, result?.runAt || clock + (error ? Math.min(3600000, 2000 * 2 ** task.attempts) : 0), clock, task.id, task.lease_token);
    if (!update.changes) fail("Worker lease lost; completion was not recorded.", 409);
  }
  const api = {
    enqueue,
    claim,
    finish,
    async recover() {
      const clock = Date.now();
      await db.exec("BEGIN IMMEDIATE");
      try {
        await db.prepare("UPDATE tasks SET status='unknown',error='Outbound send lease expired; reconcile before retrying.',lease_token=NULL,updated_at=? WHERE status='running' AND lease_until<? AND kind IN ('campaign.send','campaign.followup','alert.send','mail.test-send')").run(clock, clock);
        await db.prepare("UPDATE tasks SET status=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'queued' END,lease_token=NULL,updated_at=? WHERE status='running' AND lease_until<? AND kind NOT IN ('campaign.send','campaign.followup','alert.send','mail.test-send')").run(clock, clock);
        await reconcileExpired();
        await db.exec("COMMIT");
      } catch (e) {
        await db.exec("ROLLBACK");
        throw e;
      }
    },
    async log(id, message) {
      await db.prepare("INSERT INTO task_logs(task_id,at,message) VALUES(?,?,?)").run(id, Date.now(), String(message).slice(0, 1000));
    },
    async heartbeat(task) {
      return (await db.prepare("UPDATE tasks SET lease_until=? WHERE id=? AND lease_token=? AND status='running'").run(Date.now() + 120000, task.id, task.lease_token)).changes > 0;
    },
    async list() {
      return await db.prepare("SELECT id,kind,status,run_at,attempts,max_attempts,error,created_at,updated_at FROM tasks ORDER BY created_at DESC LIMIT 200").all();
    },
    async get(id) {
      return decode(await db.prepare("SELECT * FROM tasks WHERE id=?").get(id));
    },
    async cancel(id) {
      const changed=(await db.prepare("UPDATE tasks SET status='cancelled',updated_at=? WHERE id=? AND status='queued'").run(Date.now(),id)).changes;
      if(changed){await db.prepare("UPDATE outreach_send_log SET status='cancelled',updated_at=? WHERE task_id=? AND status='queued'").run(Date.now(),id);await db.prepare("UPDATE outreach_company_budget SET status='cancelled',updated_at=? WHERE task_id=? AND status='queued'").run(Date.now(),id);}
      return changed;
    },
    async retry(id) {
      const t = await this.get(id);
      if (!t || t.status !== "failed" || ["campaign.send", "campaign.followup", "alert.send", "mail.test-send"].includes(t.kind)) fail("Only failed non-sending tasks can be retried.", 409);
      await db.prepare("UPDATE tasks SET status='queued',attempts=0,run_at=?,updated_at=? WHERE id=?").run(Date.now(), Date.now(), id);
    },
    async logs(id) {
      return await db.prepare("SELECT at,message FROM task_logs WHERE task_id=? ORDER BY id DESC LIMIT 100").all(id);
    }
  };
  return Object.fromEntries(Object.entries(api).map(([name, fn]) => [name, (...args) => db.withSession(() => fn.apply(api,args))]));
}
