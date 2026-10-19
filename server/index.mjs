import { taskEvents } from "./events.mjs";
import { ensureSearchMatrix } from "./services/autopilot.mjs";
import { profileScope } from "./services/autopilot-policy.mjs";
import { openConfiguredStore } from "./store-config.mjs";
import { spawn } from "node:child_process";
import { hydrateResume } from "./services/resume-storage.mjs";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { upgradeRoutes } from "./upgrades.mjs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { openStore } from "./store.mjs";
import { initialState } from "./fixtures.mjs";
import { boardList, searchApollo, enrichApollo } from "./providers.mjs";
import { STAGES, id, now, hash, fail, text, safeUrl, emailValid, sampleEmail, scoreJob, parseCSV, normalizeContact, previewCampaign, campaignFingerprint, suggestStage, applicationPacket } from "./domain.mjs";
const publicRoot = fileURLToPath(new URL("../public/", import.meta.url));
const buildRoot = fileURLToPath(new URL("../dist/", import.meta.url));
const JSON_LIMIT = 8_000_000;
const csvCell = v => `"${String(v ?? "").replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`;
const filename = s => s.replace(/[^a-z0-9._-]/gi, "_").slice(0, 130);
function publicState(s) {
  const {
    previews,
    apolloResults,
    ...rest
  } = s;
  return {
    ...rest,
    jobs: s.jobs.map(j => ({
      ...j,
      semanticMatch: j.semanticMatch?.resumeHash === hash(s.resume?.text) && j.semanticMatch?.jobHash === hash(`${j.title}\n${j.description}`) ? j.semanticMatch : null,
      match: j.autopilotMatch?.scope === profileScope(s) ? j.autopilotMatch : scoreJob(j, s.profile)
    })),
    resume: s.resume ? Object.fromEntries(Object.entries(s.resume).filter(([key]) => key !== "base64")) : null
  };
}
async function bodyJSON(req) {
  if (!req.headers["content-type"]?.includes("application/json")) fail("Use application/json.", 415);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > JSON_LIMIT) fail("The request is too large.", 413);
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) fail("Expected a JSON object.");
    return data;
  } catch (e) {
    if (e.status) throw e;
    fail("Invalid JSON.");
  }
}
function authenticate(req, password) {
  if (!password) return true;
  try {
    const auth = req.headers.authorization || "";
    if (!auth.startsWith("Basic ")) return false;
    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
    const value = decoded.slice(decoded.indexOf(":") + 1);
    const a = Buffer.from(value),
      b = Buffer.from(password);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
export function createApp({
  config = process.env,
  dataDir = config.DATA_DIR || "./data",
  fetcher = fetch,
  store: providedStore
} = {}) {
  const store = providedStore || openStore(dataDir);
  const upgrade = upgradeRoutes(store, config, fetcher);
  const syncLocks = new Set();
  let sendLock = false;
  if (config.GREENHOUSE_BOARDS && !store.state.settings.greenhouseBoards.length) store.state.settings.greenhouseBoards = boardList(config.GREENHOUSE_BOARDS);
  if (config.LEVER_BOARDS && !store.state.settings.leverBoards.length) store.state.settings.leverBoards = boardList(config.LEVER_BOARDS);
  const ready = Promise.resolve(store.save());
  const json = (res, status, data) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8"
    });
    res.end(JSON.stringify(data));
  };
  const download = (res, data, type, name) => {
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${filename(name)}"`
    });
    res.end(data);
  };
  const find = (list, key, label) => {
    const item = list.find(x => x.id === key);
    if (!item) fail(`${label} not found.`, 404);
    return item;
  };
  const events = taskEvents(upgrade.queue,store);
  const server = createServer((req, res) => ready.then(() => store.run(async () => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'");
    try {
      const publicUrl = new URL(req.url || "/", "http://localhost");
      if (req.method === "GET" && publicUrl.pathname === "/api/health") return json(res,200,{ok:true});
      if (await upgrade.publicRoute(req, res, publicUrl, {
        json,
        bodyJSON
      })) return;
      if (!authenticate(req, config.WORKSPACE_PASSWORD)) {
        res.setHeader("WWW-Authenticate", 'Basic realm="Orbit workspace", charset="UTF-8"');
        return json(res, 401, {
          error: "Enter your workspace password. The username can be orbit."
        });
      }
      const host = req.headers.host || "";
      const hostname = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
      const allowed = (config.ALLOWED_HOSTS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
      if (!config.WORKSPACE_PASSWORD && !["localhost", "127.0.0.1", "::1"].includes(hostname)) fail("This local workspace only accepts loopback hosts. Set WORKSPACE_PASSWORD for remote hosting.", 403);
      if (allowed.length && !allowed.includes(hostname)) fail("Host not allowed.", 403);
      const u = new URL(req.url || "/", `http://${host || "localhost"}`),
        path = u.pathname,
        method = req.method;
      if (!["GET", "HEAD"].includes(method)) {
        if (req.headers["sec-fetch-site"] === "cross-site") fail("Cross-site writes are blocked.", 403);
        if (req.headers.origin && new URL(req.headers.origin).host !== host) fail("Cross-origin writes are blocked.", 403);
        if (sendLock) fail("A campaign is sending. Wait for it to finish before changing the workspace.", 409);
      }
      if (await upgrade.handle(req, res, u, {
        json,
        bodyJSON
      })) return;
      if (method === "GET" && path === "/api/health") return json(res, 200, {
        ok: true,
        version: "0.2.0"
      });
      if (method === "GET" && path === "/api/events") return events.connect(req,res);
      if (method === "GET" && path === "/api/state") return json(res, 200, publicState(store.state));
      if (method === "GET" && path === "/api/integrations") return json(res, 200, {
        remotive: true,
        greenhouse: true,
        lever: true,
        apollo: Boolean(config.APOLLO_API_KEY),
        resend: Boolean(config.RESEND_API_KEY && config.EMAIL_FROM),
        liveSend: config.ENABLE_LIVE_SEND === "true" && Boolean(config.RESEND_API_KEY && config.EMAIL_FROM),
        gmail: Boolean(await store.db.prepare("SELECT id FROM mail_accounts WHERE provider='google'").get()),
        outlook: Boolean(await store.db.prepare("SELECT id FROM mail_accounts WHERE provider='microsoft'").get()),
        googleOAuth: Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET && config.TOKEN_ENCRYPTION_KEY),
        microsoftOAuth: Boolean(config.MICROSOFT_CLIENT_ID && config.MICROSOFT_CLIENT_SECRET && config.TOKEN_ENCRYPTION_KEY),
        ashby: true,
        arbeitnow: true,
        adzuna: Boolean(config.ADZUNA_APP_ID && config.ADZUNA_APP_KEY),
        hunter: Boolean(config.HUNTER_API_KEY),
        ai: Boolean(config.LLM_API_KEY && config.LLM_MODEL),
        embeddings: Boolean(config.LLM_API_KEY && config.EMBEDDING_MODEL),
        queueDriver: config.REDIS_URL ? "BullMQ + Redis" : store.kind === "postgres" ? "PostgreSQL" : "SQLite",
        himalayas: true,
        liveSendEnabled: config.ENABLE_LIVE_SEND === "true",
        autoApply: "assisted"
      });
      if (method === "GET" && path === "/api/resume/download") {
        const r = await hydrateResume(store.state.resume, store, config);
        if (!r) fail("Upload a résumé first.", 404);
        return download(res, Buffer.from(r.base64, "base64"), /\.pdf$/i.test(r.name) ? "application/pdf" : /\.docx$/i.test(r.name) ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "text/plain; charset=utf-8", r.name);
      }
      if (method === "GET" && path === "/api/export/applications") {
        const s = store.state;
        const rows = [["Company", "Role", "Stage", "URL", "Updated", "Notes"], ...s.applications.map(a => {
          const j = s.jobs.find(x => x.id === a.jobId);
          return [j?.company, j?.title, a.stage, j?.url, a.updatedAt, a.notes];
        })];
        return download(res, rows.map(r => r.map(csvCell).join(",")).join("\r\n"), "text/csv; charset=utf-8", "orbit-applications.csv");
      }
      const packetMatch = path.match(/^\/api\/applications\/([^/]+)\/packet$/);
      if (method === "GET" && packetMatch) {
        const a = find(store.state.applications, packetMatch[1], "Application"),
          j = find(store.state.jobs, a.jobId, "Job");
        return download(res, applicationPacket(j, store.state.profile), "text/plain; charset=utf-8", `${j.company}-application.txt`);
      }
      const emlMatch = path.match(/^\/api\/campaigns\/([^/]+)\/messages\/([^/]+)$/);
      if (method === "GET" && emlMatch) {
        const s = store.state,
          c = find(s.campaigns, emlMatch[1], "Campaign"),
          p = previewCampaign(c, s),
          m = p.messages.find(x => x.contactId === emlMatch[2]);
        if (!m) fail("Message not found.", 404);
        const boundary = `orbit-${id()}`;
        const subject = `=?UTF-8?B?${Buffer.from(m.subject).toString("base64")}?=`;
        const wrapped = data => data.match(/.{1,76}/g)?.join("\r\n") || "";
        let eml = `To: ${m.to}\r\nFrom: ${s.profile.email}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nX-Unsent: 1\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrapped(Buffer.from(m.body).toString("base64"))}\r\n`;
        if (c.attachResume && s.resume) {
          const original = await hydrateResume(s.resume, store, config);
          eml += `--${boundary}\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="${filename(s.resume.name)}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrapped(original.base64)}\r\n`;
        }
        eml += `--${boundary}--\r\n`;
        return download(res, eml, "message/rfc822", `${m.name}-draft.eml`);
      }
      if (path.startsWith("/api/") && !["GET", "HEAD"].includes(method)) {
        const data = await bodyJSON(req);
        if (sendLock) fail("A campaign is sending. Wait for it to finish before changing the workspace.", 409);
        if (syncLocks.size && path === "/api/workspace/reset") fail("Wait for the job refresh to finish before resetting the workspace.", 409);
        const s = store.state;
        if (path === "/api/workspace/reset" && method === "POST") {
          if (await store.db.prepare("SELECT id FROM tasks WHERE status='running' LIMIT 1").get()) fail("Wait for running tasks to finish, or stop the worker before resetting.", 409);
          if (!["START_FRESH", "LOAD_DEMO"].includes(data.confirm)) fail("Confirm the workspace reset.");
          await store.replace(initialState(data.confirm === "LOAD_DEMO"));
          return json(res, 200, {
            ok: true
          });
        }
        if (path === "/api/profile" && method === "PUT") {
          const p = {};
          for (const field of ["name", "email", "phone", "headline", "location", "portfolio", "authorization", "summary", "github", "linkedin", "noticePeriod", "expectedSalary"]) p[field] = text(data[field], field === "summary" ? 6000 : 300);
          if (p.email && !emailValid(p.email)) fail("Enter a valid email address.");
          if (p.portfolio && !safeUrl(p.portfolio)) fail("Use a full http:// or https:// portfolio URL.");
          for (const key of ["skills", "interests"]) {
            if (!Array.isArray(data[key]) || data[key].length > 40) fail(`Enter up to 40 ${key}.`);
            p[key] = [...new Set(data[key].map(x => text(x, 100)).filter(Boolean))];
          }
          if (!["Any", "Remote", "Hybrid", "On-site"].includes(data.workMode)) fail("Choose a supported work preference.");
          p.workMode = data.workMode;
          s.profile = {
            ...p,
            resumeUrl: s.profile.resumeUrl || ""
          };
          await store.save();
          await ensureSearchMatrix(store,config,fetcher);
          return json(res, 200, {
            ok: true
          });
        }
        if (path === "/api/resume" && method === "DELETE") {
          s.resume = null;
          await store.save();
          return json(res, 200, {
            ok: true
          });
        }
        if (path === "/api/resume/text" && method === "PUT") {
          if (!s.resume) fail("Upload a résumé first.");
          s.resume.text = text(data.text, 100000);
          await store.save();
          await ensureSearchMatrix(store,config,fetcher);
          return json(res, 200, {
            ok: true
          });
        }
        if (path === "/api/jobs/manual" && method === "POST") {
          const title = text(data.title, 200),
            company = text(data.company, 150),
            url = safeUrl(data.url);
          if (!title || !company || !url) fail("Add a role, company, and valid application URL.");
          if (s.jobs.some(j => j.url === url)) fail("This job URL is already in your workspace.", 409);
          const job = {
            id: id(),
            title,
            company,
            url,
            location: text(data.location, 200) || "Not listed",
            workMode: ["Remote", "Hybrid", "On-site"].includes(data.workMode) ? data.workMode : "On-site",
            salary: text(data.salary, 150) || "Not listed",
            tags: [],
            category: "Other",
            description: text(data.description, 30000),
            source: "Manual",
            isDemo: false,
            publishedAt: now(),
            type: "Not listed"
          };
          s.jobs.push(job);
          await store.save();
          return json(res, 201, {
            job
          });
        }
        if (path === "/api/applications" && method === "POST") {
          const j = find(s.jobs, data.jobId, "Job");
          if (!STAGES.includes(data.stage || "Saved")) fail("Unknown application stage.");
          const existing = s.applications.find(a => a.jobId === j.id);
          if (existing) return json(res, 200, {
            application: existing,
            existing: true
          });
          const a = {
            id: id(),
            jobId: j.id,
            stage: data.stage || "Saved",
            notes: text(data.notes, 6000),
            createdAt: now(),
            updatedAt: now(),
            isDemo: j.isDemo,
            history: [{
              stage: data.stage || "Saved",
              at: now(),
              source: "Manual"
            }]
          };
          s.applications.push(a);
          await store.save();
          return json(res, 201, {
            application: a
          });
        }
        if (path === "/api/applications/batch" && method === "POST") {
          if (!Array.isArray(data.jobIds) || !data.jobIds.length || data.jobIds.length > 50) fail("Select between 1 and 50 jobs.");
          const jobs = [...new Set(data.jobIds)].map(jid => find(s.jobs, jid, "Job"));
          let added = 0;
          for (const j of jobs) {
            let a = s.applications.find(a => a.jobId === j.id);
            if (!a) {
              a = {
                id: id(),
                jobId: j.id,
                stage: "Ready",
                notes: "",
                createdAt: now(),
                updatedAt: now(),
                isDemo: j.isDemo,
                history: []
              };
              s.applications.push(a);
              added++;
            }
            if (["Ready", "Saved"].includes(a.stage)) {
              a.stage = "Ready";
              a.updatedAt = now();
              a.history.push({
                stage: "Ready",
                at: now(),
                source: "Prepared, not submitted"
              });
            }
          }
          await store.save();
          return json(res, 200, {
            added,
            count: jobs.length
          });
        }
        const appMatch = path.match(/^\/api\/applications\/([^/]+)$/);
        if (appMatch && method === "PATCH") {
          const a = find(s.applications, appMatch[1], "Application");
          if (data.stage !== undefined) {
            if (!STAGES.includes(data.stage)) fail("Unknown application stage.");
            if (a.stage !== data.stage) a.history.push({
              stage: data.stage,
              at: now(),
              source: "Manual"
            });
            a.stage = data.stage;
          }
          if (data.notes !== undefined) a.notes = text(data.notes, 6000);
          a.updatedAt = now();
          await store.save();
          return json(res, 200, {
            ok: true
          });
        }
        if (path === "/api/contacts/import" && method === "POST") {
          const rows = parseCSV(data.csv),
            incoming = [],
            errors = [];
          const seen = new Set(s.contacts.filter(c => c.email).map(c => c.email.toLowerCase()));
          for (const [i, row] of rows.entries()) {
            try {
              const c = normalizeContact(row);
              if (!c.email) {
                errors.push(`Row ${i + 2}: missing email`);
                continue;
              }
              if (seen.has(c.email)) {
                errors.push(`Row ${i + 2}: duplicate email`);
                continue;
              }
              seen.add(c.email);
              incoming.push(c);
            } catch (e) {
              errors.push(`Row ${i + 2}: ${e.message}`);
            }
          }
          s.contacts.push(...incoming);
          await store.save();
          return json(res, 200, {
            imported: incoming.length,
            skipped: errors.length,
            errors
          });
        }
        if (path === "/api/contacts" && method === "POST") {
          const c = normalizeContact(data, "Manual");
          if (!c.email) fail("Enter an email address.");
          if (s.contacts.some(x => x.email === c.email)) fail("This email is already in your contacts.", 409);
          s.contacts.push(c);
          await store.save();
          return json(res, 201, {
            contact: c
          });
        }
        if (path === "/api/contacts/apollo/search" && method === "POST") {
          const contacts = await searchApollo(data, config.APOLLO_API_KEY, fetcher);
          store.state.apolloResults = {
            at: now(),
            contacts
          };
          await store.save();
          return json(res, 200, {
            contacts
          });
        }
        if (path === "/api/contacts/apollo/save" && method === "POST") {
          if (!Array.isArray(data.ids) || data.ids.length > 25 || !s.apolloResults || Date.now() - new Date(s.apolloResults.at).getTime() > 15 * 60_000) fail("Run an Apollo search and select up to 25 results.");
          const chosen = [...new Set(data.ids)].map(cid => find(s.apolloResults.contacts, cid, "Search result"));
          let added = 0;
          for (const c of chosen) if (!s.contacts.some(x => x.apolloId === c.apolloId)) {
            s.contacts.push(c);
            added++;
          }
          await store.save();
          return json(res, 200, {
            added
          });
        }
        const enrichMatch = path.match(/^\/api\/contacts\/([^/]+)\/enrich$/);
        if (enrichMatch && method === "POST") {
          if (data.confirmCredits !== true) fail("Confirm that Apollo enrichment may use credits.");
          const c = find(s.contacts, enrichMatch[1], "Contact");
          const result = await enrichApollo(c, config.APOLLO_API_KEY, fetcher);
          const latest = find(store.state.contacts, c.id, "Contact");
          if (result.email && store.state.contacts.some(x => x.id !== c.id && x.email === result.email)) fail("This email already belongs to a saved contact. No duplicate was added.", 409);
          Object.assign(latest, result);
          await store.save();
          return json(res, 200, {
            contact: latest
          });
        }
        const contactMatch = path.match(/^\/api\/contacts\/([^/]+)$/);
        if (contactMatch && method === "PATCH") {
          const c = find(s.contacts, contactMatch[1], "Contact");
          if (typeof data.suppressed !== "boolean") fail("Choose whether this contact is suppressed.");
          c.suppressed = data.suppressed;
          await store.save();
          return json(res, 200, {
            ok: true
          });
        }
        if (path === "/api/inbox/analyze" && method === "POST") {
          const a = find(s.applications, data.applicationId, "Application"),
            subject = text(data.subject, 500),
            body = text(data.body, 15000);
          if (!subject || !body) fail("Paste the email subject and body.");
          const item = {
            id: id(),
            applicationId: a.id,
            from: text(data.from, 250),
            subject,
            body,
            proposedStage: suggestStage(subject, body),
            status: "Needs review",
            createdAt: now()
          };
          s.inbox.unshift(item);
          await store.save();
          return json(res, 201, {
            item
          });
        }
        const inboxMatch = path.match(/^\/api\/inbox\/([^/]+)\/(accept|dismiss)$/);
        if (inboxMatch && method === "POST") {
          const item = find(s.inbox, inboxMatch[1], "Email update");
          if (item.status !== "Needs review") fail("This update has already been reviewed.", 409);
          if (inboxMatch[2] === "accept") {
            if (!item.proposedStage) fail("No status was detected. Update the application manually.");
            if (data.applicationId) item.applicationId = find(s.applications, data.applicationId, "Application").id;
            const a = find(s.applications, item.applicationId, "Application");
            a.stage = item.proposedStage;
            a.updatedAt = now();
            a.history.push({
              stage: item.proposedStage,
              at: now(),
              source: `Reviewed email: ${item.subject}`
            });
            item.status = "Accepted";
          } else item.status = "Dismissed";
          await store.save();
          return json(res, 200, {
            ok: true
          });
        }
        fail("API endpoint not found.", 404);
      }
      if (path.startsWith("/api/")) fail("API endpoint not found.", 404);
      if (!["GET", "HEAD"].includes(method)) fail("Method not allowed.", 405);
      const assets = {
        "/": ["index.html", "text/html; charset=utf-8"],
        "/index.html": ["index.html", "text/html; charset=utf-8"],
        "/styles.css": ["styles.css", "text/css; charset=utf-8"],
        "/favicon.svg": ["favicon.svg", "image/svg+xml"]
      };
      if (["/", "/index.html"].includes(path) && !existsSync(resolve(buildRoot, "index.html"))) fail("Build the interface with npm run build, or use npm run dev and open port 5173.", 503);
      let asset = assets[path];
      let root = publicRoot;
      if (existsSync(resolve(buildRoot, "index.html")) && ["/", "/index.html"].includes(path)) root = buildRoot;
      if (/^\/assets\/[a-zA-Z0-9_.-]+$/.test(path)) {
        root = buildRoot;
        asset = [path.slice(1), path.endsWith(".js") ? "text/javascript; charset=utf-8" : path.endsWith(".css") ? "text/css; charset=utf-8" : "application/octet-stream"];
      }
      if (["/resume.css", "/print.js"].includes(path)) asset = [path.slice(1), path.endsWith(".js") ? "text/javascript" : "text/css"];
      if (!asset) fail("Page not found.", 404);
      const content = await readFile(resolve(root, asset[0]));
      res.writeHead(200, {
        "Content-Type": asset[1]
      });
      res.end(method === "HEAD" ? undefined : content);
    } catch (e) {
      if (!res.headersSent) json(res, e.status || 500, {
        error: e.status ? e.message : "Something went wrong. Your saved workspace is still available."
      });else res.end();
      if (!e.status) console.error(e.name, "Request failed; inspect the code or reproduce with the test suite.");
    }
  })).catch(() => { if (!res.headersSent) json(res,503,{error:"Workspace storage is unavailable. Please retry."}); else res.end(); }));
  server.requestTimeout = 120000;
  server.headersTimeout = 20000;
  return {
    server,
    store,
    ready, events,
    queue: upgrade.queue
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || "127.0.0.1";
  if (!["127.0.0.1", "localhost", "::1"].includes(host) && !process.env.WORKSPACE_PASSWORD) throw new Error("Set WORKSPACE_PASSWORD before binding to a non-loopback address.");
  const app = createApp({store:await openConfiguredStore()});
  await app.ready;
  const port = Number(process.env.PORT || 3000);
  app.server.listen(port, host, () => console.log(`Orbit is running at http://${host}:${app.server.address().port}`));
  let stopping = false;
  let child;
  if (process.env.RUN_EMBEDDED_WORKER === "true") {
    child = spawn(process.execPath,[fileURLToPath(new URL("./worker.mjs",import.meta.url))],{stdio:"inherit",env:{...process.env,RUN_EMBEDDED_WORKER:"false"}});
    child.on("error",() => { console.error("Embedded worker could not start."); shutdown(1); });
    child.on("exit",() => { if (!stopping) { console.error("Embedded worker exited; restarting the service."); shutdown(1); } });
  }
  function shutdown(code=0) {
    if (stopping) return; stopping=true;
    eventsStop();
    const deadline=setTimeout(() => process.exit(code || 1),25000);deadline.unref();
    if (child && child.exitCode === null) child.kill("SIGTERM");
    const workerDone=child && child.exitCode === null ? new Promise(resolve => child.once("exit",resolve)) : Promise.resolve();
    const serverDone=new Promise(resolve => app.server.close(resolve));
    Promise.all([workerDone,serverDone]).then(() => app.store.close()).finally(() => process.exit(code));
  }
  function eventsStop() { app.events.close(); }
  for (const sig of ["SIGINT","SIGTERM"]) process.once(sig,() => shutdown());
}
