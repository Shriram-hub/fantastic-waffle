import {verifyProvider} from './services/provider-verification.mjs';
import {bootstrapJobs} from './services/job-feed.mjs';
import {effectiveProviderConfig,providerConfigView,withProviderConfig,publicProviderState} from './services/provider-config.mjs';
import {catalogJob,retainCatalogJob,catalogStats} from './services/job-catalog.mjs';
import {jobFreshness} from './services/job-freshness.mjs';
import {companyLogos} from './services/company-logos.mjs';
import {workerStatus} from './services/worker-health.mjs';
import {resumeLinkSummaries} from './services/engagement.mjs';
import {inboxActions} from './services/inbox-actions.mjs';
import {ensureJobDocuments,hydrateDocument} from './services/job-documents.mjs';
import { taskEvents } from "./events.mjs";
import { ensureSearchMatrix } from "./services/autopilot.mjs";
import { profileScope } from "./services/autopilot-policy.mjs";
import {getSearchConfig,scheduleDiscovery,searchStatus} from './services/discovery.mjs';
import {autopilotStatus} from './services/autopilot.mjs';
import {setupReadiness} from './discovery-routes.mjs';
import {listAccounts} from './providers/mail/oauth.mjs';
import {buildSearchPlan,rankOpportunity} from './services/search-plan.mjs';
import {updateCandidateFromLegacy} from './services/candidate-profile.mjs';
import {workspaceAuth,sameOrigin} from './workspace-auth.mjs';
import {careerOverview} from './services/career.mjs';
import {contactDiscoveryStatus,findCompanyContacts} from './services/contact-discovery.mjs';
import {resolveCompany} from './providers/contacts/company.mjs';
import {checkContactProviders} from './services/contact-provider-checks.mjs';
import {embeddedWorkerEnabled,requestQueueDrain} from './services/worker-control.mjs';
import {extensionCORS} from './request-origin.mjs';
import {gzipSync} from 'node:zlib';
import { openConfiguredStore } from "./store-config.mjs";
import { spawn } from "node:child_process";
import { hydrateResume } from "./services/resume-storage.mjs";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { upgradeRoutes } from "./upgrades.mjs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { timingSafeEqual,randomUUID } from "node:crypto";
import { openStore } from "./store.mjs";
import { initialState } from "./fixtures.mjs";
import { boardList, searchApollo, enrichApollo } from "./providers.mjs";
import { STAGES, id, now, hash, fail, text, safeUrl, emailValid, sampleEmail, scoreJob, parseCSV, normalizeContact, previewCampaign, campaignFingerprint, suggestStage, applicationPacket } from "./domain.mjs";
const publicRoot = fileURLToPath(new URL("../public/", import.meta.url));
const buildRoot = fileURLToPath(new URL("../dist/", import.meta.url));
const JSON_LIMIT = 8_000_000;
const csvCell = v => `"${String(v ?? "").replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`;
const filename = s => s.replace(/[^a-z0-9._-]/gi, "_").slice(0, 130);
function publicState(s,preferences,catalogue) {
  s=publicProviderState(s);
  const plan=buildSearchPlan(s,preferences),feed=bootstrapJobs(s,plan);
  const {
    previews,
    apolloResults,
    career,contactDiscoveryRuns,jobDocuments,resumeTracking,alertConfig,jobPitches,
    ...rest
  } = s;
  return {
    ...rest,
    careerSummary:careerOverview(s),
    ...feed,jobFeed:catalogue?{...feed.jobFeed,total:catalogue.active,truncated:true,capacity:catalogue.capacity,sources:catalogue.sources}:feed.jobFeed,
    jobs: s.isDemo ? feed.jobs.map(j=>({...j,match:scoreJob(j,s.profile)})) : feed.jobs,
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
export function createApp({
  config = process.env,
  dataDir = config.DATA_DIR || "./data",
  fetcher = fetch,
  store: providedStore,wakeWorker
} = {}) {
  const baseConfig=config;config=providerConfigView(config);
  const store = providedStore || openStore(dataDir);
  const upgrade = upgradeRoutes(store, config, fetcher);
  const auth=workspaceAuth(store,config,fetcher);
  const syncLocks = new Set();
  let sendLock = false;
  let settingsChanged=false;
  if (config.GREENHOUSE_BOARDS && !store.state.settings.greenhouseBoards.length) {store.state.settings.greenhouseBoards = boardList(config.GREENHOUSE_BOARDS);settingsChanged=true;}
  if (config.LEVER_BOARDS && !store.state.settings.leverBoards.length) {store.state.settings.leverBoards = boardList(config.LEVER_BOARDS);settingsChanged=true;}
  const ready = settingsChanged ? Promise.resolve(store.save()) : Promise.resolve();
  const json = (res, status, data) => {
    let payload=Buffer.from(JSON.stringify(data));
    const gzip=payload.length>12000 && /\bgzip\b/.test(res.req?.headers['accept-encoding'] || '');
    if(gzip) payload=gzipSync(payload,{level:4});
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      ...(gzip ? {'Content-Encoding':'gzip','Vary':'Accept-Encoding'} : {})
    });
    res.end(payload);
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
  const logoFor=companyLogos(fetcher);
  const events = taskEvents(upgrade.queue,store,req=>auth.authenticated(req));
  async function bootstrap() {
    const named=async(label,fn)=>{try{return await fn();}catch(e){e.operation=label;throw e;}};
    const [preferences,search,autopilot,accounts,versions,links,tasks,applications]=await Promise.all([
      named('search-config',()=>getSearchConfig(store)),named('search-status',()=>searchStatus(store)),named('autopilot-status',()=>autopilotStatus(store,config)),named('mail-accounts',()=>listAccounts(store)),
      named('resume-versions',()=>store.db.prepare('SELECT id,kind,body,created_at FROM resume_versions ORDER BY created_at DESC').all()),
      named('resume-links',()=>store.db.prepare('SELECT id,expires,revoked,views FROM public_resumes').all()),named('queue-list',()=>upgrade.queue.list()),
      named('application-tasks',()=>store.db.prepare('SELECT id,application_id,status,body FROM apply_tasks ORDER BY rowid DESC LIMIT 100').all()),
    ]);
    const setup=setupReadiness(store,config);
    return {data:publicState(store.state,preferences,search.catalogue),search,autopilot,accounts,setup,worker:await workerStatus(store),
      integrations:{remotive:true,greenhouse:true,lever:true,ashby:true,arbeitnow:true,himalayas:true,apollo:setup.apolloConfigured,hunter:setup.hunterConfigured,googleOAuth:setup.googleConfigured,microsoftOAuth:setup.microsoftConfigured,gmail:accounts.some(a=>a.provider==='google'),outlook:accounts.some(a=>a.provider==='microsoft'),resend:setup.resendConfigured,liveSendEnabled:setup.liveSendEnabled,ai:setup.aiConfigured,embeddings:!!(config.LLM_API_KEY && config.EMBEDDING_MODEL),adzuna:!!(config.ADZUNA_APP_ID && (config.ADZUNA_APP_KEY || config.ADZUNA_API_KEY)),queueDriver:config.REDIS_URL ? 'BullMQ + Redis' : store.kind==='postgres' ? 'PostgreSQL' : 'SQLite',autoApply:'assisted'},
      vault:{versions:versions.map(v=>({id:v.id,kind:v.kind,title:JSON.parse(v.body).title,createdAt:v.created_at})),links:resumeLinkSummaries(links,store.state)},
      tasks:{tasks,applications:applications.map(a=>({...a,details:JSON.parse(a.body)}))}};
  }
  async function serveAsset(req,res,path) {
    const assets={
      '/':['index.html','text/html; charset=utf-8'],'/index.html':['index.html','text/html; charset=utf-8'],
      '/styles.css':['styles.css','text/css; charset=utf-8'],'/theme.js':['theme.js','text/javascript; charset=utf-8'],
      '/favicon.svg':['favicon.svg','image/svg+xml'],'/resume.css':['resume.css','text/css'],'/print.js':['print.js','text/javascript']
    };
    const built=existsSync(resolve(buildRoot,'index.html'));
    if(['/','/index.html'].includes(path) && !built)fail('Build the interface with npm run build, or use npm run dev and open port 5173.',503);
    let asset=assets[path],root=built && ['/','/index.html'].includes(path) ? buildRoot : publicRoot;
    if(/^\/assets\/[a-zA-Z0-9_.-]+$/.test(path)) {
      root=buildRoot;asset=[path.slice(1),path.endsWith('.js')?'text/javascript; charset=utf-8':path.endsWith('.css')?'text/css; charset=utf-8':'application/octet-stream'];
    }
    if(!asset)fail('Page not found.',404);
    let content;
    try{content=await readFile(resolve(root,asset[0]));}catch(error){if(error.code==='ENOENT')fail('Asset not found.',404);throw error;}
    res.writeHead(200,{'Content-Type':asset[1]});res.end(req.method==='HEAD' ? undefined : content);
  }
  const workspaceRequest=(req,res)=>ready.then(() => store.run(async () => withProviderConfig(await effectiveProviderConfig(store,baseConfig),async()=>{
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'");
    try {
      const publicUrl = new URL(req.url || "/", "http://localhost");
      if(extensionCORS(req,res,publicUrl.pathname))return;
      if (req.method === "GET" && publicUrl.pathname === "/api/health") return json(res,200,{ok:true,version:"0.5.0"});
      if(req.method==='POST' && publicUrl.pathname==='/api/internal/workspace-check') {
        const supplied=Buffer.from(String(req.headers['x-orbit-scheduler'] || '')),expected=Buffer.from(config.AUTOPILOT_CRON_SECRET || '');
        if(!expected.length || supplied.length!==expected.length || !timingSafeEqual(supplied,expected))fail('Invalid scheduler credential.',401);
        const result=await bootstrap(),contacts=await contactDiscoveryStatus(store,config);
        let documentCheck;
        let contactFallbackCheck;
        if(publicUrl.searchParams.get('checkContactFallback')==='true') {
          const selected=publicUrl.searchParams.get('jobId'),job=selected ? store.state.jobs.find(j=>j.id===selected && !j.isDemo) : store.state.jobs.find(j=>!j.isDemo && /Deloitte|Goldman Sachs|State Street|BDO India/i.test(j.company));
          const company=job ? await resolveCompany(job,fetcher,store) : null;
          const found=company ? await findCompanyContacts(job,company,{store,config:{...config,FREE_CONTACT_WEB_SEARCH:'false'},fetcher,allowCredits:false,allowWarmSearch:false,limit:3}) : null;
          contactFallbackCheck={company:job?.company || null,domain:company?.domain || null,requiresDomainReview:company?.requiresDomainReview || false,prospects:found?.contacts.length || 0,verifiedMailboxes:found?.contacts.filter(c=>c.emailStatus==='verified').length || 0,domainHealth:found?.contacts[0]?.domainVerification || null,warnings:found?.warnings || [],note:'Read-only free-source check. No contact/search credits or email sends.'};
        }
        if(publicUrl.searchParams.get('checkDocuments')==='true') {
          const job=store.state.jobs.find(j=>!j.isDemo && !j.archived && !j.requiresSourceReview && j.discoveryMatch?.recommendable) || store.state.jobs.find(j=>!j.isDemo && !j.archived && !j.requiresSourceReview);
          const document=job ? await ensureJobDocuments(job,store,upgrade.queue,config,fetcher,false) : null;
          documentCheck=document ? {ok:true,documentId:document.id,resumeBytes:document.resume.size,coverLetterBytes:document.coverLetter.size,coverLetterWords:document.wordCount,storage:document.resume.storage?.kind || 'memory'} : {ok:false,reason:'No active role or the source profile changed.'};
        }
        return json(res,200,{ok:true,indexed:result.search.indexed,matches:result.search.matches,storage:store.kind || 'sqlite',googleConfigured:result.setup.googleConfigured,
          contactDiscovery:{hunterConfigured:contacts.hunterConfigured,dailyLimit:contacts.dailyLimit,usedToday:contacts.usedToday},career:{available:true,openTasks:result.data.careerSummary.stats.openTasks},features:{regionalBoards:true,documents:true,sequenceSteps:3,copilotVersion:"0.9.0",phoneAlerts:true,automaticInterviewPrep:true,veloceUI:true,kanban:true,commandPalette:true,documentEditor:true,linkedInDrafts:true,companyPitch:true,mailboxSelfTests:true,extensionAutoPair:true,fieldPersonas:true,hiringPostSignals:true,emailPatternLearning:true,careerPageImport:true,firstMover:true,paginatedJobFeed:true,indexCapacity:result.search.indexCapacity,curatedEmployers:result.search.curatedEmployers},documentCheck,contactFallbackCheck,providerVerification:publicUrl.searchParams.get('checkProvider')==='serper'?await verifyProvider('serper',store,config,fetcher,{confirmMetered:true}):undefined,mail:{connectedAccounts:result.accounts.length,liveSending:result.setup.liveSendEnabled},providerChecks:publicUrl.searchParams.get('checkContacts')==='true' ? await checkContactProviders(store,config,fetcher) : undefined});
      }
      if(await auth.handle(req,res,publicUrl,{json,bodyJSON}))return;
      if (await upgrade.publicRoute(req, res, publicUrl, {
        json,
        bodyJSON
      })) return;
      const publicAsset=['GET','HEAD'].includes(req.method) && (['/','/index.html','/favicon.svg','/theme.js'].includes(publicUrl.pathname) || /^\/assets\/[a-zA-Z0-9_.-]+$/.test(publicUrl.pathname));
      if (!publicAsset && !await auth.authenticated(req)) {
        return json(res, 401, {
          error: "Sign in to open your workspace.",code:'AUTH_REQUIRED'
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
        sameOrigin(req);
        if (sendLock) fail("A campaign is sending. Wait for it to finish before changing the workspace.", 409);
      }
      const indexedJob=path.match(/^\/api\/jobs\/([^/]+)\/(?:auto-pitch|documents|detail)(?:\/|$)/);
      if(indexedJob && !store.state.jobs.some(j=>j.id===indexedJob[1]))await retainCatalogJob(indexedJob[1],store);
      if (await upgrade.handle(req, res, u, {
        json,
        bodyJSON
      })) return;
      if (method === "GET" && path === "/api/health") return json(res, 200, {
        ok: true,
        version: "0.5.0"
      });
      if (method === "GET" && path === "/api/events") return store.detached ? store.detached(()=>events.connect(req,res)) : events.connect(req,res);
      if(method==='POST' && path==='/api/queue/flush') {
        await bodyJSON(req);
        const due=await store.db.prepare("SELECT count(*) AS count FROM tasks WHERE status='queued' AND run_at<=?").get(Date.now());
        if(wakeWorker)wakeWorker();else void requestQueueDrain(store,upgrade.queue,config,fetcher);
        return json(res,202,{ok:true,due:Number(due.count),message:'Worker notified. Only due tasks run; pacing, approvals and send limits remain in force.'});
      }
      const logo=path.match(/^\/api\/jobs\/([^/]+)\/logo$/);
      if(logo && method==='GET') {
        const job=store.state.jobs.find(j=>j.id===logo[1]) || await catalogJob(logo[1],store),image=job && await logoFor(job);
        if(!image){res.writeHead(204);res.end();return;}
        res.writeHead(200,{'Content-Type':image.type,'Cache-Control':'private, max-age=3600'});res.end(image.bytes);return;
      }
      if (method === 'GET' && path === '/api/bootstrap') {
        return json(res,200,await bootstrap());
      }
      if (method === "GET" && path === "/api/state") {const preferences=await getSearchConfig(store);return json(res, 200, publicState(store.state,preferences,await catalogStats(store,buildSearchPlan(store.state,preferences))));}
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
        const document=(s.jobDocuments || []).find(d=>d.id===c.documentSetId),attachments=[];
        if(c.attachResume && s.resume)attachments.push(document ? await hydrateDocument(document,'resume',store,config) : await hydrateResume(s.resume,store,config));
        if(c.attachCoverLetter && document)attachments.push(await hydrateDocument(document,'coverLetter',store,config));
        for(const attachment of attachments)eml += `--${boundary}\r\nContent-Type: ${/\.pdf$/i.test(attachment.name) ? 'application/pdf' : 'application/octet-stream'}\r\nContent-Disposition: attachment; filename="${filename(attachment.name)}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrapped(attachment.base64)}\r\n`;
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
            const max=key==='skills' ? 100 : 40;
            if (!Array.isArray(data[key]) || data[key].length > max) fail(`Enter up to ${max} ${key}.`);
            p[key] = [...new Set(data[key].map(x => text(x, 100)).filter(Boolean))];
          }
          if (!["Any", "Remote", "Hybrid", "On-site"].includes(data.workMode)) fail("Choose a supported work preference.");
          p.workMode = data.workMode;
          s.profile = {
            ...s.profile,
            ...p,
            resumeUrl: s.profile.resumeUrl || ""
          };
          updateCandidateFromLegacy(s.profile,p);
          await store.save();
          await ensureSearchMatrix(store,config,fetcher);
          const preferences=await getSearchConfig(store);
          await store.db.prepare("INSERT INTO job_search_config(id,body) VALUES('local',?) ON CONFLICT(id) DO UPDATE SET body=excluded.body")
            .run(JSON.stringify({...preferences,roles:p.interests,location:p.location,workMode:p.workMode}));
          await scheduleDiscovery(store,upgrade.queue,config,true);
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
          await scheduleDiscovery(store,upgrade.queue,config,true);
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
          if(!s.jobs.some(j=>j.id===data.jobId))await retainCatalogJob(data.jobId,store);
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
          for(const jid of [...new Set(data.jobIds)])if(!s.jobs.some(j=>j.id===jid))await retainCatalogJob(jid,store);
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
              const c = normalizeContact({...row,email_status:'unverified'});
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
          const c = normalizeContact({...data,email_status:'unverified'}, "Manual");
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
            item.messageId ||= `manual-${item.id}`;item.receivedAt ||= item.createdAt;
            await inboxActions(item,store,upgrade.queue,config);
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
      await serveAsset(req,res,path);
    } catch (e) {
      const reference=e.status ? undefined : randomUUID().slice(0,8);
      if (!res.headersSent) json(res, e.status || 500, {
        error: e.status ? e.message : "We couldn’t load your workspace. Please retry.",reference
      });else res.end();
      if (!e.status) console.error(JSON.stringify({event:'request-failed',reference,type:e.name,code:/^[A-Z0-9_]{1,40}$/.test(e.code || '') ? e.code : undefined,operation:e.operation,frames:String(e.stack || '').split('\n').filter(line=>/^\s+at /.test(line) && /\/server\//.test(line)).slice(0,5).map(line=>line.trim().replace(/file:\/\/[^ ]*\/server\//g,'server/'))}));
    }
  }),{readOnlyJobs:req.method==='GET' && (['/api/bootstrap','/api/state','/api/jobs/feed'].includes(new URL(req.url,'http://localhost').pathname) || /^\/api\/jobs\/[^/]+\/logo(?:\?|$)/.test(req.url))}));
  // Browser asset bursts, health probes, auth and long-lived events need no
  // workspace snapshot. Bound the remaining requests on the 512 MB free plan.
  let activeRequests=0;const waiting=[];
  async function scopedRequest(req,res) {
    if(activeRequests>=2) {
      if(waiting.length>=32)fail('The workspace is busy. Please retry in a moment.',503);
      await new Promise(resolve=>waiting.push(resolve));
    }else activeRequests++;
    try{if(!res.destroyed)await workspaceRequest(req,res);}
    finally{const next=waiting.shift();if(next)next();else activeRequests--;}
  }
  const server=createServer((req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'");
    void (async()=>{
      const url=new URL(req.url || '/','http://localhost'),path=url.pathname;
      const hostname=(req.headers.host || '').replace(/:\d+$/,'').replace(/^\[|\]$/g,'').toLowerCase();
      const allowed=(config.ALLOWED_HOSTS || '').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
      if(!config.WORKSPACE_PASSWORD && !['localhost','127.0.0.1','::1'].includes(hostname))fail('This local workspace only accepts loopback hosts. Set WORKSPACE_PASSWORD for remote hosting.',403);
      if(allowed.length && !allowed.includes(hostname))fail('Host not allowed.',403);
      if(extensionCORS(req,res,path))return;
      if(req.method==='GET' && path==='/api/health')return json(res,200,{ok:true,version:'0.6.0'});
      if(['GET','HEAD'].includes(req.method) && (['/','/index.html','/favicon.svg','/theme.js'].includes(path) || /^\/assets\/[a-zA-Z0-9_.-]+$/.test(path)))return serveAsset(req,res,path);
      if(await auth.handle(req,res,url,{json,bodyJSON}))return;
      if(req.method==='GET' && path==='/api/events') {
        if(!await auth.authenticated(req))fail('Sign in to open your workspace.',401);
        return store.detached ? store.detached(()=>events.connect(req,res)) : events.connect(req,res);
      }
      await scopedRequest(req,res);
    })().catch(error=>{
      const reference=error.status ? undefined : randomUUID().slice(0,8);
      if(!res.headersSent){if(!error.status)res.setHeader('Retry-After','3');json(res,error.status || 503,{error:error.status ? error.message : 'Workspace storage is temporarily unavailable. Please retry.',reference});}else res.end();
      if(!error.status)console.error(JSON.stringify({event:'workspace-storage-failed',reference,type:error.name,code:/^[A-Z0-9_]{1,40}$/.test(error.code || '')?error.code:undefined}));
    });
  });
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
  let child;
  const app = createApp({store:await openConfiguredStore(),wakeWorker:()=>{if(child?.connected)child.send({type:'queue-wake'});else void requestQueueDrain(app.store,app.queue,process.env,fetch);}});
  await app.ready;
  app.store.releaseRoot?.();
  const port = Number(process.env.PORT || 3000);
  app.server.listen(port, host, () => console.log(`Veloce is running at http://${host}:${app.server.address().port}`));
  let stopping = false,restartTimer,workerFailures=0;
  if (embeddedWorkerEnabled(process.env)) {
    startEmbeddedWorker();
  }
  function startEmbeddedWorker() {
    if(stopping)return;
    // Leave room for the API, network buffers, and PDF parsing on Render Free.
    const workerArgs=[...(process.env.RENDER_EXTERNAL_URL ? ['--max-old-space-size=160'] : []),fileURLToPath(new URL("./worker.mjs",import.meta.url))];
    child = spawn(process.execPath,workerArgs,{stdio:['inherit','inherit','inherit','ipc'],env:{...process.env,RUN_EMBEDDED_WORKER:"false",ENABLE_EMBEDDED_WORKER:'false'}});
    child.once('spawn',()=>console.log(JSON.stringify({event:'embedded-worker-started',pid:child.pid})));
    const startedAt=Date.now();let handled=false;
    function restart() {
      if(stopping || handled)return;handled=true;
      if(Date.now()-startedAt>300000)workerFailures=0;
      const delay=Math.min(30000,1000*2**Math.min(workerFailures++,5));
      console.error(JSON.stringify({event:'embedded-worker-restarting',delayMs:delay,code:child.exitCode,signal:child.signalCode}));
      // Restart only the worker. Its durable leases recover safely, while a
      // failed background task no longer takes down the sign-in/API process.
      restartTimer=setTimeout(startEmbeddedWorker,delay);restartTimer.unref();
    }
    child.on('error',restart);child.on('exit',restart);
  }
  function shutdown(code=0) {
    if (stopping) return; stopping=true;
    clearTimeout(restartTimer);
    eventsStop();
    const deadline=setTimeout(() => process.exit(code || 1),25000);deadline.unref();
    const workerRunning=child && child.exitCode===null && child.signalCode===null;
    if (workerRunning) child.kill("SIGTERM");
    const workerDone=workerRunning ? new Promise(resolve => child.once("exit",resolve)) : Promise.resolve();
    const serverDone=new Promise(resolve => app.server.close(resolve));
    Promise.all([workerDone,serverDone]).then(() => app.store.close()).finally(() => process.exit(code));
  }
  function eventsStop() { app.events.close(); }
  for (const sig of ["SIGINT","SIGTERM"]) process.once(sig,() => shutdown());
}
