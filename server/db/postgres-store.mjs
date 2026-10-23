import { AsyncLocalStorage } from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {cloneJsonState} from '../state-clone.mjs';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { collections } from '../store.mjs';
import { initialState } from '../fixtures.mjs';
import { fail } from '../domain.mjs';

const tables = ['workspace_meta', 'user_profiles', 'resumes', ...Object.values(collections)];
const runtimeTables = [...tables, 'provider_credentials','job_catalog','directory_sync', 'tasks', 'task_logs', 'mail_accounts', 'oauth_states', 'inbox_messages', 'resume_versions', 'embeddings', 'apply_tasks', 'extension_tokens', 'send_leases', 'send_budget', 'public_resumes', 'outreach_send_log', 'outreach_job_reservations', 'worker_health', 'unsubscribe_tokens', 'ai_cache', 'resume_objects', 'companies', 'search_matrices', 'autopilot_config', 'autopilot_schedule', 'autopilot_runs', 'autopilot_activity', 'provider_requests', 'job_search_config', 'job_search_runs', 'job_source_health', 'job_source_cache', 'discovered_boards', 'outreach_company_budget', 'migrations'];
export function postgresSQL(sql) {
  let result = sql.replace(/INSERT OR IGNORE INTO/gi, 'INSERT INTO');
  if (/INSERT OR IGNORE INTO/i.test(sql)) result += ' ON CONFLICT DO NOTHING';
  result = result.replace(/json_extract\(((?:[a-z_]+\.)?(?:payload|body)),'\$\.([a-zA-Z0-9_]+)'\)/g, "($1::jsonb->>'$2')").replace(/\browid\b/g, 'row_order').replace(/SET count=count\+1/g, 'SET count=orbit_runtime.send_budget.count+1');
  // Only table positions are qualified; column names and string literals stay intact.
  result = result.replace(/\b(FROM|JOIN|INTO|UPDATE|REFERENCES)\s+([a-z_]+)\b/gi, (all, keyword, table) => [...runtimeTables,'workspace_identity','auth_sessions','auth_rate_limits'].includes(table) ? `${keyword} orbit_runtime.${table}` : all);
  let quoted = false, parameter = 0, output = '';
  for (let i = 0; i < result.length; i++) {
    const c = result[i];
    if (c === "'") {
      if (quoted && result[i + 1] === "'") { output += "''"; i++; continue; }
      quoted = !quoted;
    }
    output += c === '?' && !quoted ? `$${++parameter}` : c;
  }
  return output;
}
export async function postgresPoolOptions(config) {
  let connectionString=config.DATABASE_URL;
  const url=new URL(connectionString);
  const supabase=url.hostname.endsWith(".pooler.supabase.com") || url.hostname.endsWith(".supabase.co");
  let ssl;
  if(supabase || config.DATABASE_SSL_CA) {
    if(url.searchParams.get("sslmode") === "disable")fail("This database requires verified TLS.",503);
    const ca=config.DATABASE_SSL_CA ? config.DATABASE_SSL_CA.replaceAll("\\n","\n") : await readFile(new URL("./supabase-ca.crt",import.meta.url),"utf8");
    // pg's connection-string SSL fields otherwise overwrite the supplied CA.
    for(const name of ["sslmode","sslrootcert","sslcert","sslkey"])url.searchParams.delete(name);
    connectionString=url.href;
    ssl={ca,rejectUnauthorized:true};
  }
  return {connectionString,...(ssl ? {ssl} : {}),max:4,connectionTimeoutMillis:10000,idleTimeoutMillis:30000,statement_timeout:20000,application_name:"orbit"};
}
export async function openPostgresStore(config = process.env, suppliedPool) {
  const pool = suppliedPool || new pg.Pool(await postgresPoolOptions(config));
  // pg returns int8 strings by default; these columns contain JS-safe millisecond timestamps.
  if (!suppliedPool) pool.on('error', () => console.error('PostgreSQL connection unavailable; reconnecting.'));
  const session = new AsyncLocalStorage(), context = new AsyncLocalStorage();
  const withSession = async (fn) => {
    if (session.getStore()) return fn();
    const scope = {client: null};
    return session.run(scope, async () => {
      try { return await fn(); }
      finally { if (scope.client) { try { await scope.client.query('ROLLBACK'); } finally { scope.client.release(); scope.client = null; } } }
    });
  };
  function normalize(row) {
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, ['run_at','attempts','max_attempts','lease_until','created_at','updated_at','at','expires','revoked','views','count','not_before','heartbeat_at','sequence_step','next_run','cursor','checked_at','scanned','matched','expires_at'].includes(key) && value !== null ? Number(value) : value]));
  }
  const query = async (sql, values = []) => (session.getStore()?.client || pool).query(postgresSQL(sql), values.map(v => v === undefined ? null : v));
  const db = {
    withSession,
    prepare(sql) {
      return {
        async all(...args) { return (await query(sql, args)).rows.map(normalize); },
        async get(...args) { return (await this.all(...args))[0]; },
        async run(...args) { const result = await query(sql, args); return {changes: result.rowCount}; },
      };
    },
    async exec(sql) {
      const scope = session.getStore();
      if (/^BEGIN/.test(sql)) {
        if (!scope || scope.client) throw Error('Transaction needs an isolated database session.');
        scope.client = await pool.connect();
        await scope.client.query('BEGIN');
        // A small, private workspace serializes writers across API/worker processes.
        await scope.client.query('SELECT pg_advisory_xact_lock(193731, 1)');
      } else if (/^(COMMIT|ROLLBACK)$/.test(sql)) {
        if (!scope?.client) throw Error('No active transaction.');
        const client = scope.client;
        try { await client.query(sql); } finally { scope.client = null; client.release(); }
      } else await query(sql);
    },
  };
  const entries = (state) => {
    const {profile, resume, ...meta} = state;
    for (const key of Object.keys(collections)) delete meta[key];
    return {workspace_meta: [{id:'local', value:meta}], user_profiles: [{id:'local',value:profile}], resumes: resume ? [{id:'current',value:resume}] : [], ...Object.fromEntries(Object.entries(collections).map(([key, table]) => [table, (state[key] || []).map(value => ({id:value.id,value}))]))};
  };
  const write = async (table, id, value, existing) => {
    const columns = {id, body:JSON.stringify(value)};
    if (table === 'job_listings') Object.assign(columns,{company:value.company,title:value.title});
    if (table === 'applications') Object.assign(columns,{job_id:value.jobId,stage:value.stage});
    if (table === 'contacts') Object.assign(columns,{email:value.email || null,suppressed:value.suppressed ? 1:0,job_id:value.jobId || null,company_domain:value.companyDomain || null});
    if (table === 'campaigns') Object.assign(columns,{status:value.status || 'Draft'});
    if (table === 'inbox_updates') Object.assign(columns,{application_id:value.applicationId || null});
    const names = Object.keys(columns);
    if (existing) {
      const mutable = names.filter(n => n !== 'id');
      await db.prepare(`UPDATE ${table} SET ${mutable.map(n => `${n}=?`).join(',')} WHERE id=?`).run(...mutable.map(n => columns[n]),id);
    } else await db.prepare(`INSERT INTO ${table}(${names.join(',')}) VALUES(${names.map(() => '?').join(',')})`).run(...Object.values(columns));
  };
  const assemble=groups=>({...groups.workspace_meta[0],profile:groups.user_profiles[0] || {},resume:groups.resumes[0] || null,...Object.fromEntries(Object.entries(collections).map(([key,table])=>[key,groups[table]]))});
  let cachedSnapshot,loadingSnapshot;
  async function loadSnapshot(client) {
    const revision=(await client.query("SELECT value FROM orbit_runtime.workspace_revision WHERE id='local'")).rows[0]?.value;
    const groups=Object.fromEntries(tables.map(table=>[table,[]])),records=new Map();
    const accept=(table,row)=>{
      const key=`${table}:${row.id}`,fingerprint=createHash('sha256').update(row.body).digest('base64');
      const previous=cachedSnapshot?.records.get(key);
      // Reuse immutable records across revisions; one small profile edit must
      // not allocate another 28 MB of unchanged job strings.
      const value=previous?.fingerprint===fingerprint ? previous.value : JSON.parse(row.body);
      if(table==='job_listings' && !Object.isFrozen(value))freezeRecord(value);
      records.set(key,{fingerprint,value});groups[table].push(value);
    };
    const otherTables=tables.filter(table=>table!=='job_listings');
    const other=await client.query(postgresSQL(otherTables.map(table=>`SELECT '${table}' AS collection,id,body,row_order FROM ${table}`).join(' UNION ALL ')+' ORDER BY collection,row_order'));
    for(const row of other.rows)accept(row.collection,row);
    // Keep both wire buffers and parsed rows bounded. The old UNION loaded the
    // entire index as JSON strings beside several complete object snapshots.
    let cursor=0;
    for(;;) {
      const page=await client.query('SELECT id,body,row_order FROM orbit_runtime.job_listings WHERE row_order>$1 ORDER BY row_order LIMIT 256',[cursor]);
      for(const row of page.rows)accept('job_listings',row);
      if(page.rows.length<256)break;
      cursor=Number(page.rows.at(-1).row_order);
    }
    Object.freeze(groups.job_listings);
    return {revision,state:assemble(groups),records};
  }
  const read=async()=>{
    const active=session.getStore()?.client;
    if(active)return (await loadSnapshot(active)).state;
    const revision=(await pool.query("SELECT value FROM orbit_runtime.workspace_revision WHERE id='local'")).rows[0]?.value;
    if(cachedSnapshot?.revision===revision)return cachedSnapshot.state;
    if(!loadingSnapshot)loadingSnapshot=(async()=>{
      const client=await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const next=await loadSnapshot(client);
        await client.query('COMMIT');cachedSnapshot=next;
        return next.state;
      }catch(error){await client.query('ROLLBACK');throw error;}
      finally{client.release();}
    })().finally(()=>{loadingSnapshot=null;});
    return loadingSnapshot;
  };
  // The baseline/cache is private and immutable. Only the working state is
  // copied, so concurrent edits still have independent optimistic baselines.
  function freezeRecord(value) {
    if(value && typeof value==='object' && !Object.isFrozen(value)) {for(const item of Object.values(value))freezeRecord(item);Object.freeze(value);}
    return value;
  }
  const snapshot=async({readOnlyJobs=false}={})=>{
    const base=await read();
    const state=readOnlyJobs ? {...cloneJsonState({...base,jobs:[]}),jobs:base.jobs} : cloneJsonState(base);
    return {base,state,readOnlyJobs};
  };
  const overwrite = async (state) => {
    for (const table of [...new Set(['autopilot_runs', ...[...runtimeTables].reverse().filter(t => !['companies','contacts','provider_credentials'].includes(t)), 'contacts', 'companies'])]) if (table !== 'migrations') await db.exec(`DELETE FROM ${table}`);
    for (const [table, values] of Object.entries(entries(state))) for (const row of values) await write(table,row.id,row.value,false);
  };
  if (config.DATABASE_AUTO_MIGRATE !== 'false') await pool.query(await readFile(new URL('./runtime.sql',import.meta.url),'utf8'));
  await withSession(async () => {
    await db.exec('BEGIN');
    try {
      if (!await db.prepare("SELECT id FROM workspace_meta WHERE id='local'").get()) {
        for (const [table, values] of Object.entries(entries(initialState(false)))) for (const row of values) await write(table,row.id,row.value,false);
      }
      await db.exec('COMMIT');
    } catch (e) { await db.exec('ROLLBACK'); throw e; }
  });
  let root = await snapshot();
  return {
    kind:'postgres', directory:':postgres:', db,
    get state() { const local=context.getStore() || root;if(!local)throw Error('Workspace state needs a scoped store.run() call.');return local.state; },
    // Production API/worker code always uses run(). Drop the otherwise-unused
    // startup snapshot rather than retaining a second full index indefinitely.
    releaseRoot() {root=null;},
    detached(fn) {return context.exit(()=>session.exit(fn));},
    async run(fn,options) { return withSession(async () => context.run(await snapshot(options),fn)); },
    async refresh() { const next = await snapshot(), current = context.getStore(); if (current) Object.assign(current,next); else root=next; return next.state; },
    async save(inTransaction=false) {
      return withSession(async () => {
        const local=context.getStore() || root, before=entries(local.base), after=entries(local.state);
        if(local.readOnlyJobs)throw Error('A read-only job feed cannot save workspace changes.');
        const committed=Object.fromEntries(tables.map(table=>[table,[]]));
        const beforeMaps=Object.fromEntries(Object.entries(before).map(([table,rows])=>[table,new Map(rows.map(v=>[v.id,v]))])),afterIds=Object.fromEntries(Object.entries(after).map(([table,rows])=>[table,new Set(rows.map(v=>v.id))]));
        if (!inTransaction) await db.exec('BEGIN');
        try {
          for (const table of Object.keys(before).reverse()) for (const old of before[table]) if (!afterIds[table].has(old.id)) {
            const current=await db.prepare(`SELECT body FROM ${table} WHERE id=?`).get(old.id);
            if (current?.body !== JSON.stringify(old.value)) fail('This record changed. Refresh and retry.',409);
            await db.prepare(`DELETE FROM ${table} WHERE id=?`).run(old.id);
          }
          for (const [table, values] of Object.entries(after)) for (const {id,value} of values) {
            const old=beforeMaps[table].get(id);
            if (old && JSON.stringify(old.value) === JSON.stringify(value)) {committed[table].push(old.value);continue;}
            const current=await db.prepare(`SELECT body FROM ${table} WHERE id=?`).get(id);
            if ((current && (!old || current.body !== JSON.stringify(old.value))) || (old && !current)) fail('This record changed. Refresh and retry.',409);
            await write(table,id,value,Boolean(current));
            committed[table].push(cloneJsonState(value));
          }
          if (!inTransaction) await db.exec('COMMIT');
          local.base=assemble(committed);
        } catch(e) { if (!inTransaction) await db.exec('ROLLBACK'); throw e; }
      });
    },
    async replace(next) { return withSession(async () => {await db.exec('BEGIN');try {await overwrite(next);await db.exec('COMMIT');const local=context.getStore()||root;local.state=next;local.base=cloneJsonState(next);}catch(e){await db.exec('ROLLBACK');throw e;}}); },
    async close() { await pool.end(); },
  };
}
