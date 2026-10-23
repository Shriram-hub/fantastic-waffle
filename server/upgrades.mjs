import {workbenchRoutes} from './workbench-routes.mjs';
import {sameApplicationLocation,sameApplicationHost} from '../extension/location.mjs';
import {connectionRoutes} from './connection-routes.mjs';
import {redeemPackage} from './services/extension-pairing.mjs';
import {mailCheckRoutes} from './mail-check-routes.mjs';
import {jobPitchRoutes} from './job-pitch-routes.mjs';
import {queueBrowserContacts,browserImportResult} from './services/browser-contacts.mjs';
import {maintenanceRoutes} from './workspace-maintenance.mjs';
import {documentFingerprint,documentSummary} from './services/job-documents.mjs';
import {warmHook} from './services/warm-connections.mjs';
import {extensionEnhancements} from './extension-routes.mjs';
import {notificationRoutes} from './notification-routes.mjs';
import {serveResumeLink,ensureCampaignLinks,resumeLinkSummaries} from './services/engagement.mjs';
import {normalizeSequence,sequenceSteps} from './services/sequences.mjs';
import {documentRoutes} from './document-routes.mjs';
import { unsubscribeRoute } from "./services/unsubscribe.mjs";
import { autopilotRoutes } from "./autopilot-routes.mjs";
import { discoveryRoutes } from './discovery-routes.mjs';
import {candidateRoutes,importLinkedIn} from './candidate-routes.mjs';
import {contactRoutes} from './contact-routes.mjs';
import {careerRoutes} from './career-routes.mjs';
import {candidateProfile} from './services/candidate-profile.mjs';
import {suggestProfileAnswers} from './services/ai.mjs';
import { resumeHash, hydrateResume } from "./services/resume-storage.mjs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { taskQueue } from "./queue.mjs";
import { boardList } from "./providers/jobs/core.mjs";
import { JOB_SOURCES } from "./providers/jobs/index.mjs";
import { listAccounts, startOAuth, completeOAuth, tokenCipher } from "./providers/mail/oauth.mjs";
import { queueCampaign } from "./services/outreach.mjs";
import { fail, id, now, text, hash, emailValid, safeUrl, renderTemplate, previewCampaign, campaignFingerprint } from "./domain.mjs";
const keys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const equal = (a, b) => {
  const x = Buffer.from(a || ""),
    y = Buffer.from(b || "");
  return x.length === y.length && timingSafeEqual(x, y);
};
const escape = s => String(s || "").replace(/[&<>"']/g, c => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
})[c]);
const extensionAllowed = url => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password && u.hostname.includes('.') && !/^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname);
  } catch {
    return false;
  }
};
export function upgradeRoutes(store, config, fetcher) {
  const queue = taskQueue(store),
    find = (values, key, label) => {
      const v = values.find(v => v.id === key);
      if (!v) fail(`${label} not found.`, 404);
      return v;
    };
  const enqueue = async (res, json, kind, payload, options) => json(res, 202, {
    task: await queue.enqueue(kind, payload, options)
  });
  const connections=connectionRoutes(store,config,fetcher);
  const autopilot = autopilotRoutes(store,queue,config,fetcher);
  const discovery = discoveryRoutes(store,config);
  const candidate=candidateRoutes(store,queue,config,fetcher);
  const contacts=contactRoutes(store,queue,config,fetcher);
  const career=careerRoutes(store,queue,config,fetcher);
  const workbench=workbenchRoutes(store,queue,config,fetcher);
  const documents=documentRoutes(store,queue,config);
  const notifications=notificationRoutes(store,config);
  const mailChecks=mailCheckRoutes(store,queue);
  const jobPitches=jobPitchRoutes(store,queue,config);
  const maintenance=maintenanceRoutes(store,queue);
  async function publicRoute(req, res, u, {
    json,
    bodyJSON
  }) {
    if (await autopilot.publicRoute(req,res,u,{json,bodyJSON})) return true;
    const path = u.pathname;
    if(path==='/api/extension/pair' && req.method==='POST'){json(res,200,await redeemPackage(await bodyJSON(req),store,config));return true;}
    if (await unsubscribeRoute(req,res,u,store,queue)) return true;
    if (path === "/api/webhooks/microsoft") {
      if (u.searchParams.has("validationToken")) {
        res.writeHead(200, {
          "Content-Type": "text/plain"
        });
        res.end(u.searchParams.get("validationToken").slice(0, 2048));
        return true;
      }
      if (req.method !== "POST") fail("Method not allowed.", 405);
      const data = await bodyJSON(req);
      let accepted = 0;
      for (const event of (data.value || []).slice(0, 100)) {
        const rows = await store.db.prepare("SELECT * FROM mail_accounts WHERE provider='microsoft'").all();
        const account = rows.find(row => JSON.parse(row.metadata).subscriptionId === event.subscriptionId);
        if (!account) continue;
        const credentials = tokenCipher(config).open(account.secret);
        if (!equal(event.clientState, credentials.notificationSecret)) continue;
        await queue.enqueue(event.lifecycleEvent ? "inbox.watch" : "inbox.sync", {
          accountId: account.id
        }, {
          dedupeKey: `graph-${account.id}-${hash(event)}`
        });
        accepted++;
      }
      if (!accepted) fail("No authenticated Graph notifications were found.", 401);
      json(res, 202, {
        accepted
      });
      return true;
    }
    if (path === "/api/webhooks/gmail") {
      if (!config.GOOGLE_PUBSUB_AUDIENCE || !config.GOOGLE_PUBSUB_SERVICE_ACCOUNT) fail("Gmail push authentication is not configured.", 503);
      const bearer = req.headers.authorization?.replace(/^Bearer /, "");
      if (!bearer) fail("Missing push authentication.", 401);
      let claims;
      try {
        claims = (await jwtVerify(bearer, keys, {
          audience: config.GOOGLE_PUBSUB_AUDIENCE,
          issuer: ["https://accounts.google.com", "accounts.google.com"]
        })).payload;
      } catch {
        fail("Invalid Pub/Sub identity token.", 401);
      }
      if (claims.email !== config.GOOGLE_PUBSUB_SERVICE_ACCOUNT || claims.email_verified !== true) fail("Unexpected Pub/Sub service account.", 401);
      const data = await bodyJSON(req);
      let event;
      try {
        event = JSON.parse(Buffer.from(data.message?.data || "", "base64").toString());
      } catch {
        fail("Invalid Pub/Sub message.");
      }
      const a = await store.db.prepare("SELECT id FROM mail_accounts WHERE provider='google' AND email=?").get(event.emailAddress);
      if (a) await queue.enqueue("inbox.sync", {
        accountId: a.id
      }, {
        dedupeKey: `gmail-${a.id}-${data.message.messageId}`
      });
      json(res, 202, {
        accepted: true
      });
      return true;
    }
    const share = path.match(/^\/r\/([A-Za-z0-9_-]{40,100})$/);
    if (share && req.method === "GET") {
      await serveResumeLink(req,res,share[1],store,queue,config);
      return true;
    }
    if ((path!=='/api/contacts/import-browser-profiles' || req.headers.authorization?.startsWith('Bearer ')) && ["/api/extension/next", "/api/extension/report", "/api/extension/submission", "/api/extension/resume",'/api/extension/profile','/api/extension/context','/api/extension/import-linkedin','/api/extension/questions','/api/extension/documents','/api/extension/copilot','/api/extension/import-browser-profiles','/api/extension/contact-result','/api/contacts/import-browser-profiles'].includes(path)) {
      const token = req.headers.authorization?.replace(/^Bearer /, "") || "",
        valid = await store.db.prepare("SELECT id FROM extension_tokens WHERE id=? AND expires>?").get(hash(token), Date.now());
      if (!valid) fail("The extension token expired or was revoked.", 401);
      if(['/api/extension/import-browser-profiles','/api/contacts/import-browser-profiles'].includes(path) && req.method==='POST'){json(res,202,await queueBrowserContacts(await bodyJSON(req),store,queue,{tokenId:valid.id}));return true;}
      if(path==='/api/extension/contact-result' && req.method==='POST'){const data=await bodyJSON(req);json(res,200,await browserImportResult(data.taskId,store,queue,valid.id));return true;}
      if(await extensionEnhancements(req,res,u,{json,bodyJSON,valid,store,queue,config,fetcher}))return true;
      if(path==='/api/extension/profile' && req.method==='GET') {json(res,200,{profile:{...store.state.profile,master:candidateProfile(store.state.profile)},qa:store.state.settings.qaBank || [],resume:!!store.state.resume});return true;}
      if(path==='/api/extension/context' && req.method==='POST') {
        const data=await bodyJSON(req),row=await store.db.prepare("SELECT * FROM apply_tasks WHERE id=? AND token_hash=? AND status IN ('leased','needs-review','blocked')").get(data.taskId,valid.id);
        if(!row)fail('This application is no longer assigned to the paired browser.',409);
        const application=store.state.applications.find(a=>a.id===row.application_id),job=store.state.jobs.find(j=>j.id===application?.jobId),source=safeUrl(data.url);
        if(!job || !source || !sameApplicationLocation(job.url,source) || !['Saved','Ready','Outreach Sent'].includes(application.stage))fail('Return to the queued application before filling.',409);
        await store.db.prepare('UPDATE apply_tasks SET lease_until=? WHERE id=? AND token_hash=?').run(Date.now()+600000,row.id,valid.id);
        json(res,200,{profile:{...store.state.profile,master:candidateProfile(store.state.profile)},qa:store.state.settings.qaBank || [],resume:!!store.state.resume});return true;
      }
      if(path==='/api/extension/import-linkedin' && req.method==='POST') {
        const data=await bodyJSON(req);if(data.confirmOwnProfile!==true) fail('Confirm this is your own LinkedIn profile.');
        json(res,202,await importLinkedIn(data,store,queue,config));return true;
      }
      if(path==='/api/extension/questions' && req.method==='POST') {
        const data=await bodyJSON(req),row=await store.db.prepare("SELECT * FROM apply_tasks WHERE id=? AND token_hash=? AND lease_until>? AND status IN ('leased','needs-review','blocked')").get(data.taskId,valid.id,Date.now());
        if(!row) fail('Open a paired application before requesting suggestions.',409);
        const application=store.state.applications.find(a=>a.id===row.application_id),job=store.state.jobs.find(j=>j.id===application?.jobId);
        if(!job || !Array.isArray(data.questions) || data.questions.length>20) fail('Request up to 20 questions for the current application.');
        const questions=data.questions.map((q,i)=>({id:String(i),label:text(q.label,350)})).filter(q=>q.label);
        json(res,200,await suggestProfileAnswers(questions,candidateProfile(store.state.profile),job,config,fetcher,store));return true;
      }
      if (path === "/api/extension/resume" && req.method === "GET") {
        const r = store.state.resume;
        if (!r) fail("No résumé uploaded.", 404);
        json(res, 200, {
          name: r.name,
          base64: (await hydrateResume(r, store, config)).base64
        });
        return true;
      }
      if (path === "/api/extension/next" && ["GET","POST"].includes(req.method)) {
        const selection=req.method==='POST' ? (await bodyJSON(req)).taskIds : null;
        if(selection && (!Array.isArray(selection) || !selection.length || selection.length>10 || selection.some(v=>typeof v!=='string')))fail('Choose 1–10 queued application IDs.');
        await store.db.exec("BEGIN IMMEDIATE");
        try {
          const filter=selection ? ` AND id IN (${selection.map(()=>'?').join(',')})` : '';
          const row = await store.db.prepare(`SELECT * FROM apply_tasks WHERE (status='queued' OR (status='leased' AND lease_until<?))${filter} ORDER BY rowid LIMIT 1`).get(Date.now(),...(selection || []));
          if (!row) {
            await store.db.exec("COMMIT");
            json(res, 200, {
              task: null
            });
            return true;
          }
          const a = store.state.applications.find(a => a.id === row.application_id),
            j = a && store.state.jobs.find(j => j.id === a.jobId);
          if (!j || !extensionAllowed(j.url)) fail("Unsupported application destination.");
          await store.db.prepare("UPDATE apply_tasks SET status='leased',lease_until=?,token_hash=? WHERE id=?").run(Date.now() + 600000, valid.id, row.id);
          await store.db.exec("COMMIT");
          json(res, 200, {
            task: {
              id: row.id,
              url: j.url,
              company: j.company,
              role: j.title,
              profile: {...store.state.profile,master:candidateProfile(store.state.profile)},
              qa: store.state.settings.qaBank || [],
              resume: Boolean(store.state.resume)
            }
          });
          return true;
        } catch (e) {
          await store.db.exec("ROLLBACK");
          throw e;
        }
      }
      if (path === "/api/extension/submission" && req.method === "POST") {
        const data=await bodyJSON(req);
        const row=await store.db.prepare("SELECT * FROM apply_tasks WHERE id=? AND token_hash=? AND lease_until>?").get(data.taskId,valid.id,Date.now());
        if(!row)fail("Application lease expired.",409);
        const application=find(store.state.applications,row.application_id,"Application");
        const job=find(store.state.jobs,application.jobId,"Job");
        const sourceUrl=safeUrl(data.url);if(!sourceUrl)fail("Invalid confirmation URL.");
        const source=new URL(sourceUrl);
        const details=JSON.parse(row.body);
        if(!extensionAllowed(source.href) || !sameApplicationHost(job.url,source.href) && !(details.formOrigins || []).includes(source.origin))fail("Confirmation origin does not match this application.",400);
        if(row.status === "confirmed") {json(res,200,{ok:true});return true;}
        if(data.status === "submission-pending") {
          if(sameApplicationHost(job.url,source.href) ? !sameApplicationLocation(job.url,source.href) : !sameApplicationLocation(job.url,data.topUrl))fail('Submit only the queued job, or its observed embedded application form.',409);
          details.submitAttemptAt=now();details.submitUrl=source.href;
          await store.db.prepare("UPDATE apply_tasks SET status='submission-pending',body=?,lease_until=? WHERE id=?").run(JSON.stringify(details),Date.now()+15*60000,row.id);
        } else if(data.status === "confirmed") {
          const evidence=text(data.evidence,500);
          if(row.status !== "submission-pending" || !details.submitAttemptAt || Date.now()-Date.parse(details.submitAttemptAt)>15*60000 || !/thank you for applying|application (?:has been )?(?:submitted|received|sent)|we have received your application|successfully submitted/i.test(evidence))fail("An ATS confirmation after a submission attempt is required.",409);
          if(!["Saved","Ready","Outreach Sent","Applied"].includes(application.stage))fail("This application has already progressed past submission.",409);
          details.confirmation={evidence,url:source.href,at:now()};
          application.stage="Applied";application.appliedAt=now();application.updatedAt=now();
          application.history.push({stage:"Applied",at:now(),source:`ATS confirmation: ${evidence}`});
          await store.db.exec("BEGIN IMMEDIATE");
          try {await store.save(true);await store.db.prepare("UPDATE apply_tasks SET status='confirmed',body=? WHERE id=?").run(JSON.stringify(details),row.id);await store.db.exec("COMMIT");}catch(error){await store.db.exec("ROLLBACK");throw error;}
        } else fail("Unsupported submission status.");
        json(res,200,{ok:true});return true;
      }
      if (path === "/api/extension/report" && req.method === "POST") {
        const data = await bodyJSON(req),
          row = await store.db.prepare("SELECT * FROM apply_tasks WHERE id=? AND token_hash=? AND lease_until>?").get(data.taskId, valid.id, Date.now());
        if (!row) fail("Application lease expired.", 409);
        if (!["needs-review", "blocked"].includes(data.status)) fail("The extension may report review or a blocker, never submission.");
        const details = JSON.parse(row.body);
        if(data.formOrigins!==undefined) {
          const application=find(store.state.applications,row.application_id,'Application'),job=find(store.state.jobs,application.jobId,'Job'),page=safeUrl(data.pageUrl);
          if(!page || !sameApplicationLocation(job.url,page) || !Array.isArray(data.formOrigins) || data.formOrigins.length>30)fail('Report frames from the queued application page only.');
          const top=new URL(job.url).origin;
          details.formOrigins=[...new Set(data.formOrigins.filter(origin=>{try{const u=new URL(origin);return u.origin===origin && u.protocol==='https:' && (origin===top || /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|myworkdaysite\.com|smartrecruiters\.com|icims\.com|taleo\.net)$/.test(u.hostname));}catch{return false;}}))];
        }
        details.report = {
          missing: Array.isArray(data.missing) ? data.missing.map(x => text(x, 200)).slice(0, 50) : [],
          at: now()
        };
        await store.db.prepare("UPDATE apply_tasks SET status=?,body=? WHERE id=?").run(data.status, JSON.stringify(details), row.id);
        json(res, 200, {
          ok: true
        });
        return true;
      }
      fail("Method not allowed.", 405);
    }
    return false;
  }
  async function handle(req, res, u, {
    json,
    bodyJSON
  }) {
    if(await workbench(req,res,u,{json,bodyJSON}))return true;
    if(await mailChecks(req,res,u,{json,bodyJSON}))return true;
    if(await connections(req,res,u,{json,bodyJSON}))return true;
    if(await jobPitches(req,res,u,{json,bodyJSON}))return true;
    if(await maintenance(req,res,u,{json,bodyJSON}))return true;
    if (await notifications(req,res,u,{json,bodyJSON})) return true;
    if (await documents(req,res,u,{json,bodyJSON})) return true;
    if (await candidate(req,res,u,{json,bodyJSON})) return true;
    if (await contacts(req,res,u,{json,bodyJSON})) return true;
    if (await career(req,res,u,{json,bodyJSON})) return true;
    if (await discovery(req,res,u,{json,bodyJSON})) return true;
    if (await autopilot.handle(req,res,u,{json,bodyJSON})) return true;
    const path = u.pathname,
      method = req.method,
      s = store.state;
    if (method === "GET" && path === "/api/tasks") {
      json(res, 200, {
        tasks: await queue.list(),
        applications: (await store.db.prepare("SELECT id,application_id,status,body FROM apply_tasks ORDER BY rowid DESC LIMIT 100").all()).map(r => ({
          ...r,
          details: JSON.parse(r.body)
        }))
      });
      return true;
    }
    const logs = path.match(/^\/api\/tasks\/([^/]+)\/logs$/);
    if (method === "GET" && logs) {
      json(res, 200, {
        logs: await queue.logs(logs[1])
      });
      return true;
    }
    if (method === "GET" && path === "/api/mail/accounts") {
      json(res, 200, {
        accounts: await listAccounts(store)
      });
      return true;
    }
    const oauth = path.match(/^\/api\/oauth\/(google|microsoft)\/(start|callback)$/);
    if (method === "GET" && oauth) {
      if (oauth[2] === "start") {
        res.writeHead(302, {
          Location: await startOAuth(oauth[1], store, config,req)
        });
        res.end();
      } else {
        if (u.searchParams.has("error")) fail("Mailbox access was not granted.");
        await completeOAuth(oauth[1], u.searchParams.get("code"), u.searchParams.get("state"), store, config, fetcher,req);
        res.writeHead(302, {
          Location: `${config.WEB_BASE_URL || ""}/#connections`
        });
        res.end();
      }
      return true;
    }
    if (method === "GET" && path === "/api/vault") {
      json(res, 200, {
        versions: (await store.db.prepare("SELECT id,kind,body,created_at FROM resume_versions ORDER BY created_at DESC").all()).map(r => ({
          id: r.id,
          kind: r.kind,
          title: JSON.parse(r.body).title,
          createdAt: r.created_at
        })),
        links: resumeLinkSummaries(await store.db.prepare("SELECT id,expires,revoked,views FROM public_resumes").all(),store.state)
      });
      return true;
    }
    const version = path.match(/^\/api\/vault\/([^/]+)\/download$/);
    if (method === "GET" && version) {
      const row = await store.db.prepare("SELECT body FROM resume_versions WHERE id=?").get(version[1]);
      if (!row) fail("Version not found.", 404);
      const v = JSON.parse(row.body);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8"
      });
      res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(v.name)} · Résumé</title><link rel="stylesheet" href="/resume.css"><script src="/print.js" defer></script></head><body><button id="print">Print / save as PDF</button><h1>${escape(v.name)}</h1><p>${escape(v.email)}</p><h2>Relevant existing experience</h2><ul>${v.bullets.map(b => `<li>${escape(b.text)}</li>`).join("")}</ul><h2>Original résumé</h2><pre>${escape(v.sourceText)}</pre><footer>${escape(v.note)}</footer></body></html>`);
      return true;
    }
    if (["GET", "HEAD"].includes(method)) return false;
    const matched = /^\/api\/(share\/[^/]+\/revoke|tasks\/[^/]+\/(?:cancel|retry)|mail\/[^/]+\/(?:sync|watch|disconnect)|apply\/[^/]+\/(?:confirm|requeue)|contacts\/[^/]+\/(?:verify|personalize|enrich))$/.test(path) || ["/api/jobs/sync", "/api/resume",'/api/profile/parse-resume', "/api/settings", "/api/ai/extract", "/api/matching", "/api/tailor", "/api/apply/queue", "/api/extension/token", "/api/share/resume", "/api/campaigns"].includes(path) || /^\/api\/campaigns\/[^/]+(?:\/(?:send|preview|pause))?$/.test(path);
    if (!matched || path === "/api/resume" && method !== "POST") return false;
    const data = await bodyJSON(req);
    if (path === "/api/jobs/sync") {
      const source = text(data.source, 30),
        board = text(data.board, 80);
      if (!JOB_SOURCES.includes(source)) fail("Unsupported job source.");
      if (["Greenhouse", "Lever", "Ashby"].includes(source)) {
        const slugs = s.settings[`${source.toLowerCase()}Boards`] || [];
        if (!slugs.includes(board)) fail("Save the company board slug in Connections first.");
      }
      await enqueue(res, json, "jobs.sync", {
        source,
        board
      }, {
        dedupeKey: `sync-${source}-${board}-${Math.floor(Date.now() / 60000)}`
      });
      return true;
    }
    if (path === "/api/resume" || path==='/api/profile/parse-resume') {
      const name = text(data.name, 180).replace(/["\r\n/\\]/g, "_");
      if (!/\.(pdf|docx|txt)$/i.test(name) || typeof data.base64 !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(data.base64)) fail("Upload a PDF, DOCX, or TXT résumé.");
      const raw = Buffer.from(data.base64, "base64");
      if (!raw.length || raw.length > 5000000) fail("Upload a non-empty file under 5 MB.");
      if (/\.pdf$/i.test(name) && raw.subarray(0, 5).toString() !== "%PDF-") fail("Invalid PDF signature.");
      if (/\.docx$/i.test(name) && raw.subarray(0, 2).toString() !== "PK") fail("Invalid DOCX signature.");
      s.resume = {
        name,
        base64: data.base64,
        size: raw.length,
        text: "",
        parseStatus: "queued",
        uploadedAt: now()
      };
      await store.save();
      await enqueue(res, json, "resume.parse", {
        resumeHash: hash(data.base64),
        structured: false,master:path==='/api/profile/parse-resume'
      }, {
        dedupeKey: `resume-${hash(data.base64)}-${Date.now()}`
      });
      return true;
    }
    if (path === "/api/settings") {
      if(data.brand!==undefined && (!data.brand || typeof data.brand.name!=='string' || !data.brand.name.trim() || data.brand.name.length>40 || !/^#[0-9a-f]{6}$/i.test(data.brand.accent || '')))fail('Choose a workspace name up to 40 characters and a six-digit hex accent color.');
      s.settings = {
        ...s.settings,
        brand:data.brand ? {name:text(data.brand.name,40).trim(),accent:data.brand.accent} : s.settings.brand,
        greenhouseBoards: boardList(data.greenhouseBoards ?? s.settings.greenhouseBoards),
        leverBoards: boardList(data.leverBoards ?? s.settings.leverBoards),
        ashbyBoards: boardList(data.ashbyBoards ?? s.settings.ashbyBoards ?? []),
        inboxAutoUpdate: data.inboxAutoUpdate === true,
        inboxUseAI: data.inboxUseAI === true,
        dailySendLimit: Math.max(1, Math.min(50, Number(data.dailySendLimit) || 30)),
        sendTimeZone: text(data.sendTimeZone || "UTC", 80),
        qaBank: Array.isArray(data.qaBank) ? data.qaBank.slice(0, 100).map(v => ({
          question: text(v.question, 300),
          answer: text(v.answer, 3000)
        })) : s.settings.qaBank || []
      };
      try {
        new Intl.DateTimeFormat("en-US", {
          timeZone: s.settings.sendTimeZone
        });
      } catch {
        fail("Use a valid IANA time zone.");
      }
      await store.save();
      json(res, 200, {
        ok: true
      });
      return true;
    }
    if (path === "/api/ai/extract") {
      if (data.confirmed !== true) fail("Confirm sending résumé text to the configured model provider.");
      if (!config.LLM_API_KEY || !config.LLM_MODEL) fail("Configure LLM_API_KEY and LLM_MODEL.", 503);
      if (!s.resume?.text) fail("Parse résumé text first.");
      await enqueue(res, json, "resume.extract", {
        resumeHash: resumeHash(s.resume)
      }, {
        dedupeKey: `extract-${resumeHash(s.resume)}-${Date.now()}`
      });
      return true;
    }
    if (path === "/api/matching") {
      if (data.confirmed !== true) fail("Confirm the embedding request.");
      if (!config.EMBEDDING_MODEL || !config.LLM_API_KEY) fail("Configure EMBEDDING_MODEL and LLM_API_KEY.", 503);
      if (!Array.isArray(data.jobIds) || !data.jobIds.length || data.jobIds.length > 50) fail("Select 1–50 jobs.");
      data.jobIds.forEach(jid => find(s.jobs, jid, "Job"));
      await enqueue(res, json, "matching.compute", {
        jobIds: [...new Set(data.jobIds)]
      });
      return true;
    }
    if (path === "/api/tailor") {
      find(s.jobs, data.jobId, "Job");
      if (!s.resume?.text) fail("Upload and parse a résumé first.");
      await enqueue(res, json, "resume.tailor", {
        jobId: data.jobId
      });
      return true;
    }
    const taskAction = path.match(/^\/api\/tasks\/([^/]+)\/(cancel|retry)$/);
    if (taskAction) {
      if (taskAction[2] === "cancel") await queue.cancel(taskAction[1]);else await queue.retry(taskAction[1]);
      json(res, 200, {
        ok: true
      });
      return true;
    }
    const mailbox = path.match(/^\/api\/mail\/([^/]+)\/(sync|watch|disconnect)$/);
    if (mailbox) {
      if (!(await store.db.prepare("SELECT id FROM mail_accounts WHERE id=?").get(mailbox[1]))) fail("Mailbox not found.", 404);
      if (mailbox[2] === "disconnect") {
        await store.db.prepare("DELETE FROM mail_accounts WHERE id=?").run(mailbox[1]);
        await store.db.prepare("DELETE FROM autopilot_schedule WHERE id=?").run(`mailbox:${mailbox[1]}`);
        await store.db.prepare("UPDATE tasks SET status='cancelled' WHERE status='queued' AND json_extract(payload,'$.accountId')=?").run(mailbox[1]);
        json(res, 200, {
          ok: true
        });
      } else await enqueue(res, json, mailbox[2] === "watch" ? "inbox.watch" : "inbox.sync", {
        accountId: mailbox[1]
      });
      return true;
    }
    const enrich = path.match(/^\/api\/contacts\/([^/]+)\/enrich$/);
    if (enrich) {
      find(s.contacts, enrich[1], "Contact");
      if (!config.APOLLO_API_KEY) fail("Configure APOLLO_API_KEY.", 503);
      if (data.confirmCredits !== true) fail("Confirm this paid work-email enrichment lookup.");
      await enqueue(res, json, "contact.enrich", {
        contactId: enrich[1]
      }, {
        maxAttempts: 1
      });
      return true;
    }
    const verify = path.match(/^\/api\/contacts\/([^/]+)\/verify$/);
    if (verify) {
      find(s.contacts, verify[1], "Contact");
      if (!config.HUNTER_API_KEY) fail("Configure HUNTER_API_KEY.", 503);
      if (data.confirmed !== true) fail("Confirm this paid email-verification lookup.");
      await enqueue(res, json, "contact.verify", {
        contactId: verify[1]
      });
      return true;
    }
    const personalize = path.match(/^\/api\/contacts\/([^/]+)\/personalize$/);
    if (personalize) {
      find(s.contacts, personalize[1], "Contact");
      if (!config.LLM_API_KEY || !config.LLM_MODEL) fail("Configure the model provider first.", 503);
      if (data.confirmed !== true) fail("Confirm sending contact/job context to the configured model provider.");
      if (data.jobId) find(s.jobs, data.jobId, "Job");
      await enqueue(res, json, "contact.personalize", {
        contactId: personalize[1],
        jobId: data.jobId || null
      });
      return true;
    }
    if (path === "/api/extension/token") {
      if (method === "DELETE") {
        await store.db.exec("DELETE FROM extension_tokens");
        await store.db.prepare("DELETE FROM oauth_states WHERE id LIKE 'extension-package:%'").run();
        json(res, 200, {
          ok: true
        });
      } else {
        const token = randomBytes(32).toString("base64url");
        await store.db.prepare("INSERT INTO extension_tokens(id,expires) VALUES(?,?)").run(hash(token), Date.now() + 86400000);
        json(res, 201, {
          token,
          expiresAt: Date.now() + 86400000
        });
      }
      return true;
    }
    if (path === "/api/share/resume") {
      if (!s.resume) fail("Upload a résumé first.");
      if (data.approved !== true) fail("Approve creating a public, revocable résumé link.");
      const base = config.PUBLIC_BASE_URL || "http://127.0.0.1:3000",
        token = randomBytes(32).toString("base64url"),
        expires = Date.now() + 7 * 86400000;
      await store.db.prepare("INSERT INTO public_resumes(id,resume_hash,expires) VALUES(?,?,?)").run(hash(token), resumeHash(s.resume), expires);
      s.profile.resumeUrl = `${base.replace(/\/$/, "")}/r/${token}`;
      await store.save();
      json(res, 201, {
        url: s.profile.resumeUrl,
        expires
      });
      return true;
    }
    const revoke = path.match(/^\/api\/share\/([^/]+)\/revoke$/);
    if (revoke) {
      await store.db.prepare("UPDATE public_resumes SET revoked=1 WHERE id=?").run(revoke[1]);
      if (s.profile.resumeUrl && hash(s.profile.resumeUrl.split("/").at(-1)) === revoke[1]) {
        s.profile.resumeUrl = "";
        await store.save();
      }
      json(res, 200, {
        ok: true
      });
      return true;
    }
    if (path === "/api/apply/queue") {
      if (s.isDemo || !s.profile.name || !emailValid(s.profile.email || "")) fail("Start a personal workspace and save your real name and email before browser-assisted filling.");
      if (data.approved !== true) fail("Approve opening these applications in your browser.");
      if (!Array.isArray(data.jobIds) || !data.jobIds.length || data.jobIds.length > 20) fail("Choose 1–20 jobs.");
      const jobs = [...new Set(data.jobIds)].map(jid => find(s.jobs, jid, "Job"));
      if (jobs.some(j => s.applications.some(a => a.jobId === j.id && !["Saved", "Ready", "Outreach Sent"].includes(a.stage)))) fail("Only Saved, Ready or Outreach Sent opportunities can be queued for form filling.");
      if (jobs.some(j => !extensionAllowed(j.url))) fail('Choose public HTTPS application URLs. Grant each custom portal permission in the extension.');
      for (const j of jobs) if (!s.applications.some(a => a.jobId === j.id)) s.applications.push({
        id: id(),
        jobId: j.id,
        stage: "Ready",
        notes: "",
        createdAt: now(),
        updatedAt: now(),
        isDemo: false,
        history: [{
          stage: "Ready",
          at: now(),
          source: "Browser-assisted preparation"
        }]
      });
      await store.save();
      const taskIds=[];
      for (const j of jobs) {
        const a = s.applications.find(a => a.jobId === j.id);
        const existing=await store.db.prepare("SELECT id FROM apply_tasks WHERE application_id=? AND status IN ('queued','leased','needs-review','blocked','submission-pending')").get(a.id);
        const taskId=existing?.id || id();taskIds.push(taskId);
        if(!existing) await store.db.prepare("INSERT INTO apply_tasks(id,application_id,status,body) VALUES(?,?,?,?)").run(taskId, a.id, "queued", JSON.stringify({
          createdAt: now(),
          jobId: j.id
        }));
      }
      json(res, 202, {
        count: jobs.length,taskIds
      });
      return true;
    }
    const requeue = path.match(/^\/api\/apply\/([^/]+)\/requeue$/);
    if (requeue) {
      const row = await store.db.prepare("SELECT * FROM apply_tasks WHERE id=?").get(requeue[1]);
      if (!row || !["blocked", "needs-review", "leased", "submission-pending"].includes(row.status)) fail("This application cannot be requeued.", 409);
      const a = find(s.applications, row.application_id, "Application");
      if (!["Saved", "Ready", "Outreach Sent"].includes(a.stage)) fail("This opportunity is already past preparation.", 409);
      await store.db.prepare("UPDATE apply_tasks SET status='queued',token_hash=NULL,lease_until=NULL WHERE id=?").run(row.id);
      json(res, 200, {
        ok: true
      });
      return true;
    }
    const confirm = path.match(/^\/api\/apply\/([^/]+)\/confirm$/);
    if (confirm) {
      const row = await store.db.prepare("SELECT * FROM apply_tasks WHERE id=?").get(confirm[1]);
      if (!row) fail("Application task not found.", 404);
      if (!text(data.confirmationReference, 500)) fail("Add the employer confirmation reference before marking submitted.");
      const a = find(s.applications, row.application_id, "Application");
      a.stage = "Applied";
      a.updatedAt = now();
      a.history.push({
        stage: "Applied",
        at: now(),
        source: `Confirmed by user: ${text(data.confirmationReference, 500)}`
      });
      await store.save();
      await store.db.prepare("UPDATE apply_tasks SET status='confirmed' WHERE id=?").run(row.id);
      json(res, 200, {
        ok: true
      });
      return true;
    }
    const cpath = path.match(/^\/api\/campaigns(?:\/([^/]+)(?:\/(send|preview|pause))?)?$/);
    if (cpath) {
      if (cpath[2] === "pause") {
        const c = find(s.campaigns, cpath[1], "Campaign");
        if (c.sequence) c.sequence.enabled = false;
        await store.db.prepare("UPDATE tasks SET status='cancelled' WHERE status='queued' AND json_extract(payload,'$.campaignId')=?").run(c.id);
        c.status = "Paused";
        await store.save();
        json(res, 200, {
          ok: true
        });
        return true;
      }
      if (cpath[2] === "send") {
        const c = find(s.campaigns, cpath[1], "Campaign");
        json(res, 202, await queueCampaign(c, data, store, queue, config));
        return true;
      }
      if (cpath[2] === "preview") {
        const c = find(s.campaigns, cpath[1], "Campaign");
        for(const cid of c.contactIds){const contact=s.contacts.find(x=>x.id===cid);if(contact)contact.warmOpener=warmHook(contact,s);}
        await ensureCampaignLinks(c,store,config);
        const preview = previewCampaign(c, s),
          previewId = id();
        s.previews[previewId] = {
          campaignId: c.id,
          fingerprint: campaignFingerprint(c, s),
          expires: Date.now() + 600000
        };
        if (!c.deliveries.length) c.status = "Reviewed";
        await store.save();
        json(res, 200, {
          ...preview,
          previewId,
          campaignId: c.id,
          sender: c.accountId ? (await store.db.prepare("SELECT email FROM mail_accounts WHERE id=?").get(c.accountId))?.email : config.EMAIL_FROM || s.profile.email,
          sequence: c.sequence,
          documents:(s.jobDocuments || []).find(d=>d.id===c.documentSetId) ? documentSummary(s.jobDocuments.find(d=>d.id===c.documentSetId)) : null,
          followupMessages: c.sequence?.enabled ? preview.messages.map(m => ({
            contactId: m.contactId,
            steps:sequenceSteps(c.sequence).map(step=>({...step,body:renderTemplate(step.body,find(s.contacts,m.contactId,"Contact"),{...s.profile,resumeUrl:c.resumeLinks?.[m.contactId]?.url || s.profile.resumeUrl})})),
            body: renderTemplate(sequenceSteps(c.sequence)[0]?.body || "", find(s.contacts, m.contactId, "Contact"), s.profile)
          })) : [],
          liveSendReady: config.ENABLE_LIVE_SEND === "true" && Boolean(c.accountId || config.RESEND_API_KEY && config.EMAIL_FROM)
        });
        return true;
      }
      if (method !== "POST" && method !== "PATCH") fail("Method not allowed.", 405);
      if (!text(data.name, 150) || !Array.isArray(data.contactIds) || data.contactIds.length > 100) fail("Name your campaign and select up to 100 recipients.");
      const selected = [...new Set(data.contactIds)].map(cid => find(s.contacts, cid, "Contact").id);
      const c = cpath[1] ? find(s.campaigns, cpath[1], "Campaign") : {
        id: id(),
        createdAt: now(),
        deliveries: []
      };
      if (c.deliveries.length) fail("Create a new campaign after any delivery or queue attempt.", 409);
      const seq=normalizeSequence(data.sequence,data.accountId);
      const job=data.jobId ? find(s.jobs,data.jobId,'Job') : null;
      const document=data.documentSetId ? (s.jobDocuments || []).find(d=>d.id===data.documentSetId) : null;
      if(data.documentSetId && (!document || document.jobId!==job?.id || document.fingerprint!==documentFingerprint(s,job,document.useAI)))fail('Generate current tailored documents for the selected job before saving.',409);
      if(data.attachCoverLetter && !document)fail('Generate and select a tailored cover letter first.');
      if(document && selected.some(cid=>{const contact=find(s.contacts,cid,'Contact');return contact.company.toLowerCase()!==job.company.toLowerCase() && (!job.companyDomain || contact.companyDomain!==job.companyDomain);}))fail('The selected tailored documents belong to a different company. Select contacts for this job.');
      Object.assign(c, {
        name: text(data.name, 150),
        subject: text(data.subject, 500),
        body: text(data.body, 15000),
        contactIds: selected,
        attachResume: data.attachResume === true,
        attachCoverLetter:data.attachCoverLetter===true,documentSetId:document?.id || null,jobId:job?.id || null,trackResume:data.trackResume===true,
        accountId: text(data.accountId, 100) || null,
        sequence: seq,
        status: "Draft"
      });
      if (!cpath[1]) s.campaigns.unshift(c);
      await store.save();
      json(res, cpath[1] ? 200 : 201, {
        campaign: c
      });
      return true;
    }
    return false;
  }
  return {
    queue,
    handle,
    publicRoute
  };
}
