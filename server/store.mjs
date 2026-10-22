import { DatabaseSync } from "node:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import {cloneJsonState} from './state-clone.mjs';
import { mkdirSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { initialState } from "./fixtures.mjs";
import { fail } from "./domain.mjs";

export const collections = {
  jobs: "job_listings",
  applications: "applications",
  contacts: "contacts",
  campaigns: "campaigns",
  inbox: "inbox_updates",
};
export const schema = `
CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workspace_meta(id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS user_profiles(id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS resumes(id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS job_listings(id TEXT PRIMARY KEY, company TEXT, title TEXT, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS applications(id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES job_listings(id), stage TEXT NOT NULL, body TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS application_stage ON applications(stage);
CREATE UNIQUE INDEX IF NOT EXISTS application_job ON applications(job_id);
CREATE TABLE IF NOT EXISTS contacts(id TEXT PRIMARY KEY, email TEXT, suppressed INTEGER DEFAULT 0, body TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS contact_email ON contacts(email) WHERE email IS NOT NULL AND email != '';
CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY, status TEXT, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inbox_updates(id TEXT PRIMARY KEY, application_id TEXT REFERENCES applications(id), body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', run_at INTEGER NOT NULL, attempts INTEGER DEFAULT 0, max_attempts INTEGER DEFAULT 3, lease_until INTEGER, lease_token TEXT, dedupe_key TEXT UNIQUE, result TEXT, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS task_due ON tasks(status,run_at);
CREATE TABLE IF NOT EXISTS task_logs(id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, at INTEGER NOT NULL, message TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mail_accounts(id TEXT PRIMARY KEY, provider TEXT NOT NULL, email TEXT NOT NULL, secret TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS oauth_states(id TEXT PRIMARY KEY, secret TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS workspace_identity(id TEXT PRIMARY KEY CHECK(id='owner'),subject TEXT NOT NULL UNIQUE,email TEXT NOT NULL,name TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS auth_sessions(id TEXT PRIMARY KEY,body TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS auth_session_expiry ON auth_sessions(expires);
CREATE TABLE IF NOT EXISTS auth_rate_limits(id TEXT PRIMARY KEY,attempts INTEGER NOT NULL,reset_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS inbox_messages(id TEXT PRIMARY KEY, provider TEXT NOT NULL, account_id TEXT NOT NULL, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS resume_versions(id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS embeddings(id TEXT PRIMARY KEY, model TEXT NOT NULL, content_hash TEXT NOT NULL, vector TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS apply_tasks(id TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES applications(id), status TEXT NOT NULL, token_hash TEXT, lease_until INTEGER, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS extension_tokens(id TEXT PRIMARY KEY, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS send_leases(account_id TEXT PRIMARY KEY, not_before INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS send_budget(account_id TEXT NOT NULL,day TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(account_id,day));

CREATE TABLE IF NOT EXISTS outreach_job_reservations(workspace_id TEXT NOT NULL,contact_email TEXT NOT NULL CHECK(contact_email=lower(trim(contact_email))),job_id TEXT NOT NULL,campaign_id TEXT NOT NULL,task_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(workspace_id,contact_email,job_id));
CREATE TABLE IF NOT EXISTS worker_health(id TEXT PRIMARY KEY,status TEXT NOT NULL,heartbeat_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS outreach_send_log(user_id TEXT NOT NULL DEFAULT 'local',contact_email TEXT NOT NULL,campaign_id TEXT NOT NULL,sequence_step INTEGER NOT NULL DEFAULT 0,task_id TEXT NOT NULL,status TEXT NOT NULL,provider_id TEXT,updated_at INTEGER NOT NULL,PRIMARY KEY(user_id,contact_email,campaign_id,sequence_step));
CREATE TABLE IF NOT EXISTS unsubscribe_tokens(id TEXT PRIMARY KEY,email TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ai_cache(id TEXT PRIMARY KEY,body TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS public_resumes(id TEXT PRIMARY KEY, resume_hash TEXT NOT NULL, expires INTEGER NOT NULL, revoked INTEGER DEFAULT 0, views INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS companies(domain TEXT PRIMARY KEY,name TEXT NOT NULL,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS search_matrices(id TEXT PRIMARY KEY,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS autopilot_config(id TEXT PRIMARY KEY,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS autopilot_schedule(id TEXT PRIMARY KEY,next_run INTEGER NOT NULL,cursor INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS autopilot_runs(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES job_listings(id) ON DELETE CASCADE,policy_id TEXT NOT NULL,status TEXT NOT NULL,body TEXT NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS autopilot_run_status ON autopilot_runs(status,updated_at);
CREATE TABLE IF NOT EXISTS autopilot_activity(id TEXT PRIMARY KEY,at INTEGER NOT NULL,kind TEXT NOT NULL,message TEXT NOT NULL,count INTEGER);
CREATE INDEX IF NOT EXISTS autopilot_activity_time ON autopilot_activity(at);
CREATE TABLE IF NOT EXISTS provider_requests(id TEXT PRIMARY KEY,provider TEXT NOT NULL,day TEXT NOT NULL,status TEXT NOT NULL,body TEXT,created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS provider_request_budget ON provider_requests(day,provider);
CREATE TABLE IF NOT EXISTS job_search_config(id TEXT PRIMARY KEY,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS job_search_runs(id TEXT PRIMARY KEY,status TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS job_source_health(id TEXT PRIMARY KEY,source TEXT NOT NULL,board TEXT NOT NULL,checked_at INTEGER NOT NULL,status TEXT NOT NULL,scanned INTEGER NOT NULL,matched INTEGER NOT NULL,message TEXT);
CREATE TABLE IF NOT EXISTS job_source_cache(id TEXT PRIMARY KEY,expires_at INTEGER NOT NULL,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS discovered_boards(id TEXT PRIMARY KEY,source TEXT NOT NULL,slug TEXT NOT NULL,status TEXT NOT NULL,body TEXT NOT NULL,checked_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS outreach_company_budget(domain TEXT NOT NULL,email TEXT NOT NULL,task_id TEXT NOT NULL,status TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(domain,email));
CREATE INDEX IF NOT EXISTS outreach_company_window ON outreach_company_budget(domain,updated_at);
`;
export function openStore(directory) {
  let path = ":memory:";
  if (directory !== ":memory:") {
    const root = resolve(directory);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    path = resolve(root, "orbit.sqlite");
  }
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
  );
  db.exec(schema);
  // Additive upgrade for existing local workspaces.
  const contactColumns = db.prepare("PRAGMA table_info(contacts)").all().map(c => c.name);
  if (!contactColumns.includes("job_id")) db.exec("ALTER TABLE contacts ADD COLUMN job_id TEXT REFERENCES job_listings(id) ON DELETE SET NULL");
  if (!contactColumns.includes("company_domain")) db.exec("ALTER TABLE contacts ADD COLUMN company_domain TEXT REFERENCES companies(domain)");
  db.exec("CREATE INDEX IF NOT EXISTS contact_job ON contacts(job_id); CREATE INDEX IF NOT EXISTS contact_domain ON contacts(company_domain)");
  if (path !== ":memory:") chmodSync(path, 0o600);
  const context = new AsyncLocalStorage();
  const rows = (table) =>
    db
      .prepare(`SELECT body FROM ${table} ORDER BY rowid`)
      .all()
      .map((r) => JSON.parse(r.body));
  function read() {
    const meta = db
      .prepare("SELECT body FROM workspace_meta WHERE id='local'")
      .get();
    return {
      ...(meta ? JSON.parse(meta.body) : {}),
      profile: rows("user_profiles")[0] || {},
      resume: rows("resumes")[0] || null,
      ...Object.fromEntries(
        Object.entries(collections).map(([key, table]) => [key, rows(table)]),
      ),
    };
  }
  function entries(state) {
    const { profile, resume, ...meta } = state;
    for (const key of Object.keys(collections)) delete meta[key];
    return {
      workspace_meta: [{ id: "local", value: meta }],
      user_profiles: [{ id: "local", value: profile }],
      resumes: resume ? [{ id: "current", value: resume }] : [],
      ...Object.fromEntries(
        Object.entries(collections).map(([key, table]) => [
          table,
          (state[key] || []).map((value) => ({ id: value.id, value })),
        ]),
      ),
    };
  }
  function insert(table, key, value) {
    const body = JSON.stringify(value);
    if (table === "job_listings")
      db.prepare(
        "INSERT INTO job_listings(id,company,title,body) VALUES(?,?,?,?)",
      ).run(key, value.company, value.title, body);
    else if (table === "applications")
      db.prepare(
        "INSERT INTO applications(id,job_id,stage,body) VALUES(?,?,?,?)",
      ).run(key, value.jobId, value.stage, body);
    else if (table === "contacts")
      db.prepare(
        "INSERT INTO contacts(id,email,suppressed,job_id,company_domain,body) VALUES(?,?,?,?,?,?)",
      ).run(key, value.email || null, value.suppressed ? 1 : 0, value.jobId || null, value.companyDomain || null, body);
    else if (table === "campaigns")
      db.prepare("INSERT INTO campaigns(id,status,body) VALUES(?,?,?)").run(
        key,
        value.status || "Draft",
        body,
      );
    else if (table === "inbox_updates")
      db.prepare(
        "INSERT INTO inbox_updates(id,application_id,body) VALUES(?,?,?)",
      ).run(key, value.applicationId || null, body);
    else db.prepare(`INSERT INTO ${table}(id,body) VALUES(?,?)`).run(key, body);
  }
  function overwrite(state) {
    for (const table of [
      "discovered_boards","outreach_company_budget","job_source_cache", "job_source_health", "job_search_runs", "job_search_config",
      "autopilot_runs", "autopilot_config", "autopilot_schedule", "autopilot_activity", "search_matrices", "provider_requests",
      "outreach_job_reservations", "worker_health", "outreach_send_log",
      "unsubscribe_tokens",
      "ai_cache",
      "mail_accounts",
      "oauth_states",
      "send_leases",
      "send_budget",
      "apply_tasks",
      "inbox_messages",
      "public_resumes",
      "extension_tokens",
      "tasks",
      "resume_versions",
      "embeddings",
      "inbox_updates",
      "applications",
      "contacts",
      "companies",
      "campaigns",
      "job_listings",
      "resumes",
      "user_profiles",
      "workspace_meta",
    ])
      db.exec(`DELETE FROM ${table}`);
    for (const [table, values] of Object.entries(entries(state)))
      for (const { id, value } of values) insert(table, id, value);
  }
  if (!db.prepare("SELECT version FROM migrations WHERE version=2").get()) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const legacy = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='workspace'",
        )
        .get();
      const previous =
        legacy && db.prepare("SELECT data FROM workspace WHERE id=1").get();
      overwrite(previous ? JSON.parse(previous.data) : initialState(false));
      db.prepare("INSERT INTO migrations(version,applied_at) VALUES(2,?)").run(
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  const snapshot = () => {
    const state = read();
    return { state, base: cloneJsonState(state) };
  };
  let root = snapshot();
  function save(inTransaction = false) {
    const local = context.getStore() || root,
      before = entries(local.base),
      after = entries(local.state);
    const beforeMaps=Object.fromEntries(Object.entries(before).map(([table,rows])=>[table,new Map(rows.map(v=>[v.id,v]))])),afterIds=Object.fromEntries(Object.entries(after).map(([table,rows])=>[table,new Set(rows.map(v=>v.id))]));
    if (!inTransaction) db.exec("BEGIN IMMEDIATE");
    try {
      for (const table of Object.keys(before).reverse())
        for (const old of before[table])
          if (!afterIds[table].has(old.id)) {
            const row = db
              .prepare(`SELECT body FROM ${table} WHERE id=?`)
              .get(old.id);
            if (row?.body !== JSON.stringify(old.value))
              fail("This record changed. Refresh and retry.", 409);
            db.prepare(`DELETE FROM ${table} WHERE id=?`).run(old.id);
          }
      for (const [table, values] of Object.entries(after))
        for (const { id, value } of values) {
          const old = beforeMaps[table].get(id);
          if (old && JSON.stringify(old.value) === JSON.stringify(value))
            continue;
          const current = db
            .prepare(`SELECT body FROM ${table} WHERE id=?`)
            .get(id);
          if (current && (!old || current.body !== JSON.stringify(old.value)))
            fail(
              "This record changed in another request. Refresh and retry.",
              409,
            );
          if (old && !current)
            fail("This record was removed. Refresh and retry.", 409);
          if (current) {
            db.prepare(`UPDATE ${table} SET body=? WHERE id=?`).run(
              JSON.stringify(value),
              id,
            );
            if (table === "applications")
              db.prepare("UPDATE applications SET stage=? WHERE id=?").run(
                value.stage,
                id,
              );
            if (table === "contacts")
              db.prepare(
                "UPDATE contacts SET email=?,suppressed=?,job_id=?,company_domain=? WHERE id=?",
              ).run(value.email || null, value.suppressed ? 1 : 0, value.jobId || null, value.companyDomain || null, id);
            if (table === "inbox_updates")
              db.prepare(
                "UPDATE inbox_updates SET application_id=? WHERE id=?",
              ).run(value.applicationId || null, id);
            if (table === "campaigns")
              db.prepare("UPDATE campaigns SET status=? WHERE id=?").run(
                value.status,
                id,
              );
            if (table === "job_listings")
              db.prepare(
                "UPDATE job_listings SET company=?,title=? WHERE id=?",
              ).run(value.company, value.title, id);
          } else insert(table, id, value);
        }
      if (!inTransaction) db.exec("COMMIT");
      local.base = cloneJsonState(local.state);
    } catch (e) {
      if (!inTransaction) db.exec("ROLLBACK");
      throw e;
    }
  }
  return {
    db,
    directory,
    get state() {
      return (context.getStore() || root).state;
    },
    save,
    // Long-lived SSE timers must not keep a request's index snapshot alive.
    detached(fn) {return context.exit(fn);},
    run(fn) {
      return context.run(snapshot(), fn);
    },
    refresh() {
      const next = snapshot(),
        local = context.getStore();
      if (local) Object.assign(local, next);
      else root = next;
      return next.state;
    },
    replace(next) {
      db.exec("BEGIN IMMEDIATE");
      try {
        overwrite(next);
        db.exec("COMMIT");
        const local = context.getStore() || root;
        local.state = next;
        local.base = cloneJsonState(next);
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    close() {
      db.close();
    },
  };
}
