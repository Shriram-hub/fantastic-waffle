import { fail, hash } from "../domain.mjs";

// Reserve before a credit-consuming request. A crashed/ambiguous request is held
// for reconciliation rather than automatically repeated and charged twice.
const reservations=new WeakMap(),inflight=new WeakMap();
export async function providerCall(store,...args) {
  const [key,provider]=args,requestKey=hash([provider,key]);
  const running=inflight.get(store) || new Map();inflight.set(store,running);
  if(running.has(requestKey))return running.get(requestKey);
  const previous=reservations.get(store) || Promise.resolve();
  const reserve=()=>reserveCall(store,...args);
  // A provider reservation must not share an API/worker transaction context
  // with concurrent contact-status writes. Network calls remain in the caller.
  const reserved=previous.catch(()=>{}).then(()=>store.kind==='postgres'?store.detached(()=>store.db.withSession(reserve)):reserve());
  reservations.set(store,reserved);
  const pending=reserved.then(async reservation=>{
    if(reservation.cached)return reservation.value;
    try{const value=await args[3]();await store.db.prepare("UPDATE provider_requests SET status='completed',body=? WHERE id=?").run(JSON.stringify(value),reservation.requestId);return value;}
    catch(error){await store.db.prepare("UPDATE provider_requests SET status='held' WHERE id=?").run(reservation.requestId);throw error;}
  });
  running.set(requestKey,pending);
  try{return await pending;}finally{running.delete(requestKey);if(reservations.get(store)===reserved)reservations.delete(store);}
}
async function reserveCall(store, key, provider, limit) {
  const requestId = hash([provider,key]), old = await store.db.prepare("SELECT * FROM provider_requests WHERE id=?").get(requestId);
  if (old) {
    if (old.status === "completed") return {cached:true,value:JSON.parse(old.body)};
    fail(`${provider} lookup is held after an interrupted or failed request. Inspect provider usage before retrying.`, 409);
  }
  await store.db.exec("BEGIN IMMEDIATE");
  try {
    const day = new Date().toISOString().slice(0,10);
    const jobs=['JSearch','SerpApi','Brave'].includes(provider),search=['Serper','Tavily'].includes(provider),clause=jobs ? "provider IN ('JSearch','SerpApi','Brave')" : search ? "provider IN ('Serper','Tavily')" : "provider NOT IN ('JSearch','SerpApi','Brave','Serper','Tavily')";
    const used = (await store.db.prepare(`SELECT count(*) AS count FROM provider_requests WHERE day=? AND ${clause}`).get(day)).count;
    if (Number(used) >= limit) fail(jobs || search ? 'Daily optional search API limit reached. Free job sources continue.' : "Daily contact API request limit reached. Discovery will continue; contact lookup resumes on a later sweep.", 429);
    const inserted = await store.db.prepare("INSERT OR IGNORE INTO provider_requests(id,provider,day,status,created_at) VALUES(?,?,?,'started',?)").run(requestId,provider,day,Date.now());
    if (!inserted.changes) fail("This provider lookup is already reserved.",409);
    await store.db.exec("COMMIT");
  } catch(e) { await store.db.exec("ROLLBACK"); throw e; }
  return {requestId};
}
