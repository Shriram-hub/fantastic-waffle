import { randomUUID } from "node:crypto";
import { fail } from "./domain.mjs";
export function taskQueue(store) {
  const db = store.db;
  const decode = (row) =>
    row && {
      ...row,
      payload: JSON.parse(row.payload),
      result: row.result ? JSON.parse(row.result) : null,
    };
  function enqueue(
    kind,
    payload,
    { runAt = Date.now(), dedupeKey = null, maxAttempts = 3 } = {},
  ) {
    const id = randomUUID(),
      at = Date.now();
    db.prepare(
      "INSERT OR IGNORE INTO tasks(id,kind,payload,run_at,dedupe_key,max_attempts,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
    ).run(
      id,
      kind,
      JSON.stringify(payload),
      runAt,
      dedupeKey,
      maxAttempts,
      at,
      at,
    );
    return decode(
      db
        .prepare(
          dedupeKey
            ? "SELECT * FROM tasks WHERE dedupe_key=?"
            : "SELECT * FROM tasks WHERE id=?",
        )
        .get(dedupeKey || id),
    );
  }
  function reconcileExpired() {
    for (const task of db
      .prepare(
        "SELECT id,kind,payload FROM tasks WHERE status='unknown' AND lease_until IS NOT NULL AND kind IN ('campaign.send','campaign.followup')",
      )
      .all()) {
      const payload = JSON.parse(task.payload),
        row = db
          .prepare("SELECT body FROM campaigns WHERE id=?")
          .get(payload.campaignId || "");
      if (row) {
        const campaign = JSON.parse(row.body),
          delivery = campaign.deliveries.find(
            (d) => d.taskId === (payload.parentTaskId || task.id),
          );
        if (delivery) {
          if (task.kind === "campaign.followup")
            delivery.followupStatus = "unknown";
          else delivery.status = "unknown";
          delivery.error = "Worker lease expired. Reconcile with the provider.";
          campaign.status = "Needs attention";
          db.prepare("UPDATE campaigns SET status=?,body=? WHERE id=?").run(
            campaign.status,
            JSON.stringify(campaign),
            campaign.id,
          );
        }
      }
      db.prepare("UPDATE tasks SET lease_until=NULL WHERE id=?").run(task.id);
    }
  }
  function claim(wantedId, clock = Date.now()) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "UPDATE tasks SET status='unknown',error='Worker lease expired during an outbound send. Reconcile with the provider.',updated_at=? WHERE status='running' AND lease_until<? AND kind IN ('campaign.send','campaign.followup')",
      ).run(clock, clock);
      db.prepare(
        "UPDATE tasks SET status=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'queued' END,lease_token=NULL,updated_at=? WHERE status='running' AND lease_until<? AND kind NOT IN ('campaign.send','campaign.followup')",
      ).run(clock, clock);
      reconcileExpired();
      const row = wantedId
        ? db
            .prepare(
              "SELECT * FROM tasks WHERE id=? AND status='queued' AND run_at<=?",
            )
            .get(wantedId, clock)
        : db
            .prepare(
              "SELECT * FROM tasks WHERE status='queued' AND run_at<=? ORDER BY run_at,created_at LIMIT 1",
            )
            .get(clock);
      if (!row) {
        db.exec("COMMIT");
        return null;
      }
      const token = randomUUID();
      db.prepare(
        "UPDATE tasks SET status='running',attempts=attempts+1,lease_until=?,lease_token=?,updated_at=? WHERE id=?",
      ).run(clock + 120000, token, clock, row.id);
      db.exec("COMMIT");
      return decode(db.prepare("SELECT * FROM tasks WHERE id=?").get(row.id));
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  function finish(task, result, error) {
    const clock = Date.now(),
      outbound = ["campaign.send", "campaign.followup"].includes(task.kind),
      status = error
        ? outbound
          ? "unknown"
          : task.attempts < task.max_attempts
            ? "queued"
            : "failed"
        : result?.status === "deferred"
          ? "queued"
          : result?.status === "failed"
            ? "failed"
            : result?.status === "unknown"
              ? "unknown"
              : result?.status === "cancelled"
                ? "cancelled"
                : "completed";
    const update = db
      .prepare(
        "UPDATE tasks SET status=?,result=?,error=?,run_at=?,lease_until=NULL,lease_token=NULL,updated_at=? WHERE id=? AND lease_token=? AND status='running'",
      )
      .run(
        status,
        result ? JSON.stringify(result) : null,
        error ? String(error.message).slice(0, 1000) : null,
        result?.runAt ||
          clock + (error ? Math.min(3600000, 2000 * 2 ** task.attempts) : 0),
        clock,
        task.id,
        task.lease_token,
      );
    if (!update.changes)
      fail("Worker lease lost; completion was not recorded.", 409);
  }
  return {
    enqueue,
    claim,
    finish,
    recover() {
      const clock = Date.now();
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          "UPDATE tasks SET status='unknown',error='Outbound send lease expired; reconcile before retrying.',lease_token=NULL,updated_at=? WHERE status='running' AND lease_until<? AND kind IN ('campaign.send','campaign.followup')",
        ).run(clock, clock);
        db.prepare(
          "UPDATE tasks SET status=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'queued' END,lease_token=NULL,updated_at=? WHERE status='running' AND lease_until<? AND kind NOT IN ('campaign.send','campaign.followup')",
        ).run(clock, clock);
        reconcileExpired();
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    log(id, message) {
      db.prepare("INSERT INTO task_logs(task_id,at,message) VALUES(?,?,?)").run(
        id,
        Date.now(),
        String(message).slice(0, 1000),
      );
    },
    heartbeat(task) {
      return (
        db
          .prepare(
            "UPDATE tasks SET lease_until=? WHERE id=? AND lease_token=? AND status='running'",
          )
          .run(Date.now() + 120000, task.id, task.lease_token).changes > 0
      );
    },
    list() {
      return db
        .prepare(
          "SELECT id,kind,status,run_at,attempts,max_attempts,error,created_at,updated_at FROM tasks ORDER BY created_at DESC LIMIT 200",
        )
        .all();
    },
    get(id) {
      return decode(db.prepare("SELECT * FROM tasks WHERE id=?").get(id));
    },
    cancel(id) {
      return db
        .prepare(
          "UPDATE tasks SET status='cancelled',updated_at=? WHERE id=? AND status='queued'",
        )
        .run(Date.now(), id).changes;
    },
    retry(id) {
      const t = this.get(id);
      if (
        !t ||
        t.status !== "failed" ||
        ["campaign.send", "campaign.followup"].includes(t.kind)
      )
        fail("Only failed non-sending tasks can be retried.", 409);
      db.prepare(
        "UPDATE tasks SET status='queued',attempts=0,run_at=?,updated_at=? WHERE id=?",
      ).run(Date.now(), Date.now(), id);
    },
    logs(id) {
      return db
        .prepare(
          "SELECT at,message FROM task_logs WHERE task_id=? ORDER BY id DESC LIMIT 100",
        )
        .all(id);
    },
  };
}
