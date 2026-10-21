import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../server/store.mjs";
import { taskQueue } from "../server/queue.mjs";
import { initialState } from "../server/fixtures.mjs";
const directory = (t) => {
  const path = mkdtempSync(join(tmpdir(), "orbit-v2-"));
  t.after(() => rmSync(path, { force: true, recursive: true }));
  return path;
};
test("migrates the v1 workspace into relational rows without losing domain records", (t) => {
  const dir = directory(t),
    legacy = new DatabaseSync(join(dir, "orbit.sqlite")),
    state = initialState();
  state.profile.name = "Legacy owner";
  legacy.exec(
    "CREATE TABLE workspace(id INTEGER PRIMARY KEY,data TEXT NOT NULL)",
  );
  legacy
    .prepare("INSERT INTO workspace VALUES(1,?)")
    .run(JSON.stringify(state));
  legacy.close();
  const store = openStore(dir);
  assert.equal(store.state.profile.name, "Legacy owner");
  assert.equal(
    store.db.prepare("SELECT count(*) AS n FROM job_listings").get().n,
    12,
  );
  assert.equal(
    store.db.prepare("SELECT count(*) AS n FROM applications").get().n,
    6,
  );
  assert.equal(
    store.db.prepare("SELECT version FROM migrations").get().version,
    2,
  );
  store.close();
  const reopened = openStore(dir);
  assert.equal(reopened.state.profile.name, "Legacy owner");
  reopened.close();
});
test("independent processes preserve separate edits and reject conflicting edits", async (t) => {
  const dir = directory(t),
    a = openStore(dir),
    b = openStore(dir);
  a.replace(initialState(true));b.refresh();
  t.after(() => {
    a.close();
    b.close();
  });
  let release, ready;
  const gate = new Promise((r) => {
      release = r;
    }),
    started = new Promise((r) => {
      ready = r;
    });
  const editing = a.run(async () => {
    a.state.profile.name = "First edit";
    ready();
    await gate;
    a.save();
  });
  await started;
  b.run(() => {
    b.state.contacts[0].suppressed = true;
    b.save();
  });
  release();
  await editing;
  assert.equal(a.refresh().profile.name, "First edit");
  assert.equal(a.state.contacts[0].suppressed, true);
  let proceed;
  const wait = new Promise((r) => {
    proceed = r;
  });
  const conflict = a.run(async () => {
    a.state.profile.name = "Stale edit";
    await wait;
    assert.throws(() => a.save(), /changed/);
  });
  b.run(() => {
    b.state.profile.name = "Newer edit";
    b.save();
  });
  proceed();
  await conflict;
  assert.equal(a.refresh().profile.name, "Newer edit");
});
test("task claims are atomic across connections, deduplicated, and lease-fenced", (t) => {
  const dir = directory(t),
    a = openStore(dir),
    b = openStore(dir),
    qa = taskQueue(a),
    qb = taskQueue(b);
  t.after(() => {
    a.close();
    b.close();
  });
  const task = qa.enqueue(
    "jobs.sync",
    { source: "Remotive" },
    { dedupeKey: "same-import" },
  );
  assert.equal(
    qb.enqueue("jobs.sync", {}, { dedupeKey: "same-import" }).id,
    task.id,
  );
  const claimed = qa.claim();
  assert.equal(qb.claim(), null);
  qa.finish(claimed, { count: 12 });
  assert.equal(qb.get(task.id).status, "completed");
  assert.throws(() => qa.finish(claimed, {}), /lease/);
});
test("expired read-only tasks can retry; outbound requests become unknown instead", (t) => {
  const store = openStore(":memory:"),
    q = taskQueue(store);
  t.after(() => store.close());
  const read = q.enqueue("jobs.sync", {}),
    send = q.enqueue("campaign.send", {}, { maxAttempts: 1 });
  const r = q.claim(read.id),
    s = q.claim(send.id),
    later = Date.now() + 130000;
  assert.equal(q.claim(read.id, later).id, r.id);
  assert.equal(q.claim(send.id, later), null);
  assert.equal(q.get(send.id).status, "unknown");
  assert.throws(() => q.retry(send.id), /non-sending/);
});
test("cancel and backoff preserve work and expose a bounded activity log", (t) => {
  const store = openStore(":memory:"),
    q = taskQueue(store);
  t.after(() => store.close());
  const task = q.enqueue("jobs.sync", {}),
    claimed = q.claim(task.id);
  q.log(task.id, "Import started");
  q.finish(claimed, null, Error("Temporary provider failure"));
  assert.equal(q.get(task.id).status, "queued");
  assert.ok(q.get(task.id).run_at > Date.now());
  assert.equal(q.cancel(task.id), 1);
  assert.equal(q.get(task.id).status, "cancelled");
  assert.equal(q.logs(task.id)[0].message, "Import started");
});
