import { fail, hash } from "../domain.mjs";

// Reserve before a credit-consuming request. A crashed/ambiguous request is held
// for reconciliation rather than automatically repeated and charged twice.
export async function providerCall(store, key, provider, limit, operation) {
  const requestId = hash([provider,key]), old = await store.db.prepare("SELECT * FROM provider_requests WHERE id=?").get(requestId);
  if (old) {
    if (old.status === "completed") return JSON.parse(old.body);
    fail(`${provider} lookup is held after an interrupted or failed request. Inspect provider usage before retrying.`, 409);
  }
  await store.db.exec("BEGIN IMMEDIATE");
  try {
    const day = new Date().toISOString().slice(0,10);
    const used = (await store.db.prepare("SELECT count(*) AS count FROM provider_requests WHERE day=?").get(day)).count;
    if (Number(used) >= limit) fail("Daily contact API request limit reached. Discovery will continue; contact lookup resumes on a later sweep.", 429);
    const inserted = await store.db.prepare("INSERT OR IGNORE INTO provider_requests(id,provider,day,status,created_at) VALUES(?,?,?,'started',?)").run(requestId,provider,day,Date.now());
    if (!inserted.changes) fail("This provider lookup is already reserved.",409);
    await store.db.exec("COMMIT");
  } catch(e) { await store.db.exec("ROLLBACK"); throw e; }
  try {
    const value = await operation();
    await store.db.prepare("UPDATE provider_requests SET status='completed',body=? WHERE id=?").run(JSON.stringify(value),requestId);
    return value;
  } catch(e) {
    await store.db.prepare("UPDATE provider_requests SET status='held' WHERE id=?").run(requestId);
    throw e;
  }
}
