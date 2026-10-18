import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { openStore } from "./store.mjs";
import { initialState } from "./fixtures.mjs";
import { parseResume } from "./resume.mjs";
import {
  boardList,
  fetchJobs,
  searchApollo,
  enrichApollo,
  sendResend,
} from "./providers.mjs";
import {
  STAGES,
  id,
  now,
  hash,
  fail,
  text,
  safeUrl,
  emailValid,
  sampleEmail,
  scoreJob,
  parseCSV,
  normalizeContact,
  previewCampaign,
  campaignFingerprint,
  suggestStage,
  applicationPacket,
} from "./domain.mjs";

const publicRoot = fileURLToPath(new URL("../public/", import.meta.url));
const JSON_LIMIT = 8_000_000;
const csvCell = (v) =>
  `"${String(v ?? "")
    .replace(/^[=+@\-\t\r]/, "'$&")
    .replaceAll('"', '""')}"`;
const filename = (s) => s.replace(/[^a-z0-9._-]/gi, "_").slice(0, 130);
function publicState(s) {
  const { previews, apolloResults, ...rest } = s;
  return {
    ...rest,
    jobs: s.jobs.map((j) => ({ ...j, match: scoreJob(j, s.profile) })),
    resume: s.resume
      ? {
          name: s.resume.name,
          size: s.resume.size,
          text: s.resume.text,
          uploadedAt: s.resume.uploadedAt,
        }
      : null,
  };
}
async function bodyJSON(req) {
  if (!req.headers["content-type"]?.includes("application/json"))
    fail("Use application/json.", 415);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > JSON_LIMIT) fail("The request is too large.", 413);
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data))
      fail("Expected a JSON object.");
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
} = {}) {
  const store = openStore(dataDir);
  const syncLocks = new Set();
  let sendLock = false;
  if (config.GREENHOUSE_BOARDS && !store.state.settings.greenhouseBoards.length)
    store.state.settings.greenhouseBoards = boardList(config.GREENHOUSE_BOARDS);
  if (config.LEVER_BOARDS && !store.state.settings.leverBoards.length)
    store.state.settings.leverBoards = boardList(config.LEVER_BOARDS);
  store.save();
  const json = (res, status, data) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(data));
  };
  const download = (res, data, type, name) => {
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${filename(name)}"`,
    });
    res.end(data);
  };
  const find = (list, key, label) => {
    const item = list.find((x) => x.id === key);
    if (!item) fail(`${label} not found.`, 404);
    return item;
  };
  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'",
    );
    try {
      if (!authenticate(req, config.WORKSPACE_PASSWORD)) {
        res.setHeader(
          "WWW-Authenticate",
          'Basic realm="Orbit workspace", charset="UTF-8"',
        );
        return json(res, 401, {
          error: "Enter your workspace password. The username can be orbit.",
        });
      }
      const host = req.headers.host || "";
      const hostname = host
        .replace(/:\d+$/, "")
        .replace(/^\[|\]$/g, "")
        .toLowerCase();
      const allowed = (config.ALLOWED_HOSTS || "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (
        !config.WORKSPACE_PASSWORD &&
        !["localhost", "127.0.0.1", "::1"].includes(hostname)
      )
        fail(
          "This local workspace only accepts loopback hosts. Set WORKSPACE_PASSWORD for remote hosting.",
          403,
        );
      if (allowed.length && !allowed.includes(hostname))
        fail("Host not allowed.", 403);
      const u = new URL(req.url || "/", `http://${host || "localhost"}`),
        path = u.pathname,
        method = req.method;
      if (!["GET", "HEAD"].includes(method)) {
        if (req.headers["sec-fetch-site"] === "cross-site")
          fail("Cross-site writes are blocked.", 403);
        if (req.headers.origin && new URL(req.headers.origin).host !== host)
          fail("Cross-origin writes are blocked.", 403);
        if (sendLock)
          fail(
            "A campaign is sending. Wait for it to finish before changing the workspace.",
            409,
          );
      }
      if (method === "GET" && path === "/api/health")
        return json(res, 200, { ok: true, version: "0.1.0" });
      if (method === "GET" && path === "/api/state")
        return json(res, 200, publicState(store.state));
      if (method === "GET" && path === "/api/integrations")
        return json(res, 200, {
          remotive: true,
          greenhouse: true,
          lever: true,
          apollo: Boolean(config.APOLLO_API_KEY),
          resend: Boolean(config.RESEND_API_KEY && config.EMAIL_FROM),
          liveSend:
            config.ENABLE_LIVE_SEND === "true" &&
            Boolean(config.RESEND_API_KEY && config.EMAIL_FROM),
          gmail: false,
          outlook: false,
          autoApply: false,
        });
      if (method === "GET" && path === "/api/resume/download") {
        const r = store.state.resume;
        if (!r) fail("Upload a résumé first.", 404);
        return download(
          res,
          Buffer.from(r.base64, "base64"),
          /\.pdf$/i.test(r.name)
            ? "application/pdf"
            : /\.docx$/i.test(r.name)
              ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              : "text/plain; charset=utf-8",
          r.name,
        );
      }
      if (method === "GET" && path === "/api/export/applications") {
        const s = store.state;
        const rows = [
          ["Company", "Role", "Stage", "URL", "Updated", "Notes"],
          ...s.applications.map((a) => {
            const j = s.jobs.find((x) => x.id === a.jobId);
            return [
              j?.company,
              j?.title,
              a.stage,
              j?.url,
              a.updatedAt,
              a.notes,
            ];
          }),
        ];
        return download(
          res,
          rows.map((r) => r.map(csvCell).join(",")).join("\r\n"),
          "text/csv; charset=utf-8",
          "orbit-applications.csv",
        );
      }
      const packetMatch = path.match(/^\/api\/applications\/([^/]+)\/packet$/);
      if (method === "GET" && packetMatch) {
        const a = find(store.state.applications, packetMatch[1], "Application"),
          j = find(store.state.jobs, a.jobId, "Job");
        return download(
          res,
          applicationPacket(j, store.state.profile),
          "text/plain; charset=utf-8",
          `${j.company}-application.txt`,
        );
      }
      const emlMatch = path.match(
        /^\/api\/campaigns\/([^/]+)\/messages\/([^/]+)$/,
      );
      if (method === "GET" && emlMatch) {
        const s = store.state,
          c = find(s.campaigns, emlMatch[1], "Campaign"),
          p = previewCampaign(c, s),
          m = p.messages.find((x) => x.contactId === emlMatch[2]);
        if (!m) fail("Message not found.", 404);
        const boundary = `orbit-${id()}`;
        const subject = `=?UTF-8?B?${Buffer.from(m.subject).toString("base64")}?=`;
        const wrapped = (data) => data.match(/.{1,76}/g)?.join("\r\n") || "";
        let eml = `To: ${m.to}\r\nFrom: ${s.profile.email}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nX-Unsent: 1\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrapped(Buffer.from(m.body).toString("base64"))}\r\n`;
        if (c.attachResume && s.resume)
          eml += `--${boundary}\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="${filename(s.resume.name)}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrapped(s.resume.base64)}\r\n`;
        eml += `--${boundary}--\r\n`;
        return download(res, eml, "message/rfc822", `${m.name}-draft.eml`);
      }
      if (path.startsWith("/api/") && !["GET", "HEAD"].includes(method)) {
        const data = await bodyJSON(req);
        if (sendLock)
          fail(
            "A campaign is sending. Wait for it to finish before changing the workspace.",
            409,
          );
        if (syncLocks.size && path === "/api/workspace/reset")
          fail(
            "Wait for the job refresh to finish before resetting the workspace.",
            409,
          );
        const s = store.state;
        if (path === "/api/workspace/reset" && method === "POST") {
          if (!["START_FRESH", "LOAD_DEMO"].includes(data.confirm))
            fail("Confirm the workspace reset.");
          store.replace(initialState(data.confirm === "LOAD_DEMO"));
          return json(res, 200, { ok: true });
        }
        if (path === "/api/profile" && method === "PUT") {
          const p = {};
          for (const field of [
            "name",
            "email",
            "phone",
            "headline",
            "location",
            "portfolio",
            "authorization",
            "summary",
          ])
            p[field] = text(data[field], field === "summary" ? 6000 : 300);
          if (p.email && !emailValid(p.email))
            fail("Enter a valid email address.");
          if (p.portfolio && !safeUrl(p.portfolio))
            fail("Use a full http:// or https:// portfolio URL.");
          for (const key of ["skills", "interests"]) {
            if (!Array.isArray(data[key]) || data[key].length > 40)
              fail(`Enter up to 40 ${key}.`);
            p[key] = [
              ...new Set(data[key].map((x) => text(x, 100)).filter(Boolean)),
            ];
          }
          if (!["Any", "Remote", "Hybrid", "On-site"].includes(data.workMode))
            fail("Choose a supported work preference.");
          p.workMode = data.workMode;
          s.profile = p;
          store.save();
          return json(res, 200, { ok: true });
        }
        if (path === "/api/resume" && method === "POST") {
          const result = parseResume(data);
          s.resume = result.resume;
          store.save();
          return json(res, 200, {
            name: result.resume.name,
            text: result.resume.text,
            suggestions: result.suggestions,
            warning: result.warning,
          });
        }
        if (path === "/api/resume" && method === "DELETE") {
          s.resume = null;
          store.save();
          return json(res, 200, { ok: true });
        }
        if (path === "/api/resume/text" && method === "PUT") {
          if (!s.resume) fail("Upload a résumé first.");
          s.resume.text = text(data.text, 100000);
          store.save();
          return json(res, 200, { ok: true });
        }
        if (path === "/api/settings" && method === "PUT") {
          s.settings = {
            greenhouseBoards: boardList(data.greenhouseBoards),
            leverBoards: boardList(data.leverBoards),
          };
          store.save();
          return json(res, 200, { ok: true });
        }
        if (path === "/api/jobs/manual" && method === "POST") {
          const title = text(data.title, 200),
            company = text(data.company, 150),
            url = safeUrl(data.url);
          if (!title || !company || !url)
            fail("Add a role, company, and valid application URL.");
          if (s.jobs.some((j) => j.url === url))
            fail("This job URL is already in your workspace.", 409);
          const job = {
            id: id(),
            title,
            company,
            url,
            location: text(data.location, 200) || "Not listed",
            workMode: ["Remote", "Hybrid", "On-site"].includes(data.workMode)
              ? data.workMode
              : "On-site",
            salary: text(data.salary, 150) || "Not listed",
            tags: [],
            category: "Other",
            description: text(data.description, 30000),
            source: "Manual",
            isDemo: false,
            publishedAt: now(),
            type: "Not listed",
          };
          s.jobs.push(job);
          store.save();
          return json(res, 201, { job });
        }
        if (path === "/api/jobs/sync" && method === "POST") {
          const source = text(data.source, 30),
            board = text(data.board, 80),
            key = `${source}:${board}`;
          if (!["Remotive", "Greenhouse", "Lever"].includes(source))
            fail("Select a supported source.");
          if (
            source !== "Remotive" &&
            !(
              source === "Greenhouse"
                ? s.settings.greenhouseBoards
                : s.settings.leverBoards
            ).includes(board)
          )
            fail("Save this job-board slug in Connections first.");
          if (syncLocks.has(key))
            fail("This source is already refreshing.", 409);
          const previous = s.syncs[key],
            cooldown =
              previous?.ok && source === "Remotive" ? 6 * 3600_000 : 60_000;
          if (
            previous &&
            Date.now() - new Date(previous.at).getTime() < cooldown
          )
            return json(res, 200, {
              cached: true,
              count: previous.count || 0,
              message: previous.ok
                ? "Using the most recent sync. Remotive refreshes at most once every six hours."
                : "The previous attempt failed. Wait one minute before retrying.",
            });
          syncLocks.add(key);
          s.syncs[key] = { at: now(), ok: false, count: 0 };
          store.save();
          try {
            const jobs = await fetchJobs(source, board, fetcher);
            const current = store.state;
            const incoming = new Set(jobs.map((j) => j.id));
            for (const j of current.jobs)
              if (
                j.source === source &&
                (j.board || "") === board &&
                !incoming.has(j.id)
              )
                j.archived = true;
            const map = new Map(current.jobs.map((j) => [j.id, j]));
            for (const j of jobs) map.set(j.id, j);
            current.jobs = [...map.values()];
            current.syncs[key] = { at: now(), ok: true, count: jobs.length };
            store.save();
            return json(res, 200, { count: jobs.length });
          } catch (e) {
            store.state.syncs[key] = {
              at: now(),
              ok: false,
              count: 0,
              error: e.message,
            };
            store.save();
            throw e;
          } finally {
            syncLocks.delete(key);
          }
        }
        if (path === "/api/applications" && method === "POST") {
          const j = find(s.jobs, data.jobId, "Job");
          if (!STAGES.includes(data.stage || "Saved"))
            fail("Unknown application stage.");
          const existing = s.applications.find((a) => a.jobId === j.id);
          if (existing)
            return json(res, 200, { application: existing, existing: true });
          const a = {
            id: id(),
            jobId: j.id,
            stage: data.stage || "Saved",
            notes: text(data.notes, 6000),
            createdAt: now(),
            updatedAt: now(),
            isDemo: j.isDemo,
            history: [
              { stage: data.stage || "Saved", at: now(), source: "Manual" },
            ],
          };
          s.applications.push(a);
          store.save();
          return json(res, 201, { application: a });
        }
        if (path === "/api/applications/batch" && method === "POST") {
          if (
            !Array.isArray(data.jobIds) ||
            !data.jobIds.length ||
            data.jobIds.length > 50
          )
            fail("Select between 1 and 50 jobs.");
          const jobs = [...new Set(data.jobIds)].map((jid) =>
            find(s.jobs, jid, "Job"),
          );
          let added = 0;
          for (const j of jobs) {
            let a = s.applications.find((a) => a.jobId === j.id);
            if (!a) {
              a = {
                id: id(),
                jobId: j.id,
                stage: "Ready",
                notes: "",
                createdAt: now(),
                updatedAt: now(),
                isDemo: j.isDemo,
                history: [],
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
                source: "Prepared, not submitted",
              });
            }
          }
          store.save();
          return json(res, 200, { added, count: jobs.length });
        }
        const appMatch = path.match(/^\/api\/applications\/([^/]+)$/);
        if (appMatch && method === "PATCH") {
          const a = find(s.applications, appMatch[1], "Application");
          if (data.stage !== undefined) {
            if (!STAGES.includes(data.stage))
              fail("Unknown application stage.");
            if (a.stage !== data.stage)
              a.history.push({
                stage: data.stage,
                at: now(),
                source: "Manual",
              });
            a.stage = data.stage;
          }
          if (data.notes !== undefined) a.notes = text(data.notes, 6000);
          a.updatedAt = now();
          store.save();
          return json(res, 200, { ok: true });
        }
        if (path === "/api/contacts/import" && method === "POST") {
          const rows = parseCSV(data.csv),
            incoming = [],
            errors = [];
          const seen = new Set(
            s.contacts.filter((c) => c.email).map((c) => c.email.toLowerCase()),
          );
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
          store.save();
          return json(res, 200, {
            imported: incoming.length,
            skipped: errors.length,
            errors,
          });
        }
        if (path === "/api/contacts" && method === "POST") {
          const c = normalizeContact(data, "Manual");
          if (!c.email) fail("Enter an email address.");
          if (s.contacts.some((x) => x.email === c.email))
            fail("This email is already in your contacts.", 409);
          s.contacts.push(c);
          store.save();
          return json(res, 201, { contact: c });
        }
        if (path === "/api/contacts/apollo/search" && method === "POST") {
          const contacts = await searchApollo(
            data,
            config.APOLLO_API_KEY,
            fetcher,
          );
          store.state.apolloResults = { at: now(), contacts };
          store.save();
          return json(res, 200, { contacts });
        }
        if (path === "/api/contacts/apollo/save" && method === "POST") {
          if (
            !Array.isArray(data.ids) ||
            data.ids.length > 25 ||
            !s.apolloResults ||
            Date.now() - new Date(s.apolloResults.at).getTime() > 15 * 60_000
          )
            fail("Run an Apollo search and select up to 25 results.");
          const chosen = [...new Set(data.ids)].map((cid) =>
            find(s.apolloResults.contacts, cid, "Search result"),
          );
          let added = 0;
          for (const c of chosen)
            if (!s.contacts.some((x) => x.apolloId === c.apolloId)) {
              s.contacts.push(c);
              added++;
            }
          store.save();
          return json(res, 200, { added });
        }
        const enrichMatch = path.match(/^\/api\/contacts\/([^/]+)\/enrich$/);
        if (enrichMatch && method === "POST") {
          if (data.confirmCredits !== true)
            fail("Confirm that Apollo enrichment may use credits.");
          const c = find(s.contacts, enrichMatch[1], "Contact");
          const result = await enrichApollo(c, config.APOLLO_API_KEY, fetcher);
          const latest = find(store.state.contacts, c.id, "Contact");
          if (
            result.email &&
            store.state.contacts.some(
              (x) => x.id !== c.id && x.email === result.email,
            )
          )
            fail(
              "This email already belongs to a saved contact. No duplicate was added.",
              409,
            );
          Object.assign(latest, result);
          store.save();
          return json(res, 200, { contact: latest });
        }
        const contactMatch = path.match(/^\/api\/contacts\/([^/]+)$/);
        if (contactMatch && method === "PATCH") {
          const c = find(s.contacts, contactMatch[1], "Contact");
          if (typeof data.suppressed !== "boolean")
            fail("Choose whether this contact is suppressed.");
          c.suppressed = data.suppressed;
          store.save();
          return json(res, 200, { ok: true });
        }
        if (path === "/api/campaigns" && method === "POST") {
          if (!text(data.name, 150)) fail("Name your campaign.");
          if (!Array.isArray(data.contactIds) || data.contactIds.length > 100)
            fail("Select up to 100 contacts.");
          const c = {
            id: id(),
            name: text(data.name, 150),
            subject: text(data.subject, 500),
            body: text(data.body, 15000),
            contactIds: [...new Set(data.contactIds)].map(
              (cid) => find(s.contacts, cid, "Contact").id,
            ),
            attachResume: data.attachResume === true,
            status: "Draft",
            createdAt: now(),
            deliveries: [],
          };
          s.campaigns.unshift(c);
          store.save();
          return json(res, 201, { campaign: c });
        }
        const editCampaignMatch = path.match(/^\/api\/campaigns\/([^/]+)$/);
        if (editCampaignMatch && method === "PATCH") {
          const c = find(s.campaigns, editCampaignMatch[1], "Campaign");
          if (c.deliveries.length)
            fail(
              "Campaigns with delivery attempts cannot be edited. Create a new campaign.",
              409,
            );
          if (
            !text(data.name, 150) ||
            !Array.isArray(data.contactIds) ||
            data.contactIds.length > 100
          )
            fail("Name the campaign and choose up to 100 contacts.");
          const selected = [...new Set(data.contactIds)].map(
            (cid) => find(s.contacts, cid, "Contact").id,
          );
          Object.assign(c, {
            name: text(data.name, 150),
            subject: text(data.subject, 500),
            body: text(data.body, 15000),
            contactIds: selected,
            attachResume: data.attachResume === true,
            status: "Draft",
            updatedAt: now(),
          });
          store.save();
          return json(res, 200, { campaign: c });
        }
        const campaignMatch = path.match(
          /^\/api\/campaigns\/([^/]+)\/(preview|send)$/,
        );
        if (campaignMatch && method === "POST") {
          const c = find(s.campaigns, campaignMatch[1], "Campaign");
          if (campaignMatch[2] === "preview") {
            const preview = previewCampaign(c, s),
              previewId = id();
            s.previews[previewId] = {
              campaignId: c.id,
              fingerprint: campaignFingerprint(c, s),
              expires: Date.now() + 10 * 60_000,
            };
            for (const [k, v] of Object.entries(s.previews))
              if (v.expires < Date.now()) delete s.previews[k];
            if (c.status === "Draft") c.status = "Reviewed";
            store.save();
            return json(res, 200, {
              ...preview,
              previewId,
              campaignId: c.id,
              liveSendReady:
                config.ENABLE_LIVE_SEND === "true" &&
                Boolean(config.RESEND_API_KEY && config.EMAIL_FROM),
            });
          }
          if (
            config.ENABLE_LIVE_SEND !== "true" ||
            !config.RESEND_API_KEY ||
            !config.EMAIL_FROM
          )
            fail(
              "Live sending is disabled. Configure RESEND_API_KEY, EMAIL_FROM, and ENABLE_LIVE_SEND=true on the server.",
              503,
            );
          if (
            !emailValid(config.EMAIL_FROM) ||
            /[\r\n]/.test(config.EMAIL_FROM)
          )
            fail("EMAIL_FROM must be a plain, verified sender address.", 503);
          if (syncLocks.size)
            fail("Wait for the job refresh to finish before sending.", 409);
          const p = s.previews[data.previewId];
          if (
            !p ||
            p.campaignId !== c.id ||
            p.expires < Date.now() ||
            p.fingerprint !== campaignFingerprint(c, s)
          )
            fail(
              "Preview this campaign again. The preview expired or the workspace changed.",
              409,
            );
          const preview = previewCampaign(c, s);
          if (
            data.approved !== true ||
            data.confirmCount !== preview.messages.length
          )
            fail("Approve the reviewed recipient count before sending.");
          if (
            preview.messages.some(
              (m) => m.isDemo || m.emailStatus !== "verified",
            ) ||
            sampleEmail(s.profile.email)
          )
            fail(
              "Live sending requires real, verified recipient emails and your real profile email. Sample and unverified emails are preview-only.",
            );
          const pending = preview.messages.filter(
            (m) =>
              !(c.deliveries || []).some(
                (d) =>
                  d.contactId === m.contactId &&
                  ["accepted", "sending", "unknown"].includes(d.status),
              ),
          );
          if (!pending.length)
            fail(
              "These messages are already accepted or need reconciliation. Duplicate sending was blocked.",
              409,
            );
          const today = now().slice(0, 10);
          const used = s.campaigns
            .flatMap((x) => x.deliveries || [])
            .filter(
              (d) =>
                d.at?.startsWith(today) &&
                ["accepted", "sending", "unknown"].includes(d.status),
            ).length;
          if (used + pending.length > 100)
            fail("The prototype limit is 100 messages per day.");
          sendLock = true;
          try {
            for (const m of pending) {
              const key = `orbit-${hash([c.id, m.contactId, m.subject, m.body, c.attachResume ? hash(s.resume.base64) : ""])}`;
              let record = c.deliveries.find((d) => d.key === key);
              if (!record) {
                record = { key, contactId: m.contactId };
                c.deliveries.push(record);
              }
              Object.assign(record, { status: "sending", at: now() });
              store.save();
              const result = await sendResend(
                { ...m, replyTo: s.profile.email },
                config,
                c.attachResume ? s.resume : null,
                key,
                fetcher,
              );
              Object.assign(record, result);
              store.save();
              if (result.status !== "accepted") break;
              if (m !== pending.at(-1)) await delay(650);
            }
            c.status = preview.messages.every((m) =>
              c.deliveries.some(
                (d) => d.contactId === m.contactId && d.status === "accepted",
              ),
            )
              ? "Accepted by provider"
              : "Needs attention";
            store.save();
            return json(res, 200, {
              status: c.status,
              deliveries: c.deliveries,
            });
          } finally {
            sendLock = false;
          }
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
            createdAt: now(),
          };
          s.inbox.unshift(item);
          store.save();
          return json(res, 201, { item });
        }
        const inboxMatch = path.match(
          /^\/api\/inbox\/([^/]+)\/(accept|dismiss)$/,
        );
        if (inboxMatch && method === "POST") {
          const item = find(s.inbox, inboxMatch[1], "Email update");
          if (item.status !== "Needs review")
            fail("This update has already been reviewed.", 409);
          if (inboxMatch[2] === "accept") {
            if (!item.proposedStage)
              fail("No status was detected. Update the application manually.");
            const a = find(s.applications, item.applicationId, "Application");
            a.stage = item.proposedStage;
            a.updatedAt = now();
            a.history.push({
              stage: item.proposedStage,
              at: now(),
              source: `Reviewed email: ${item.subject}`,
            });
            item.status = "Accepted";
          } else item.status = "Dismissed";
          store.save();
          return json(res, 200, { ok: true });
        }
        fail("API endpoint not found.", 404);
      }
      if (path.startsWith("/api/")) fail("API endpoint not found.", 404);
      if (!["GET", "HEAD"].includes(method)) fail("Method not allowed.", 405);
      const assets = {
        "/": ["index.html", "text/html; charset=utf-8"],
        "/index.html": ["index.html", "text/html; charset=utf-8"],
        "/app.js": ["app.js", "text/javascript; charset=utf-8"],
        "/styles.css": ["styles.css", "text/css; charset=utf-8"],
        "/favicon.svg": ["favicon.svg", "image/svg+xml"],
      };
      const asset = assets[path];
      if (!asset) fail("Page not found.", 404);
      const content = await readFile(resolve(publicRoot, asset[0]));
      res.writeHead(200, { "Content-Type": asset[1] });
      res.end(method === "HEAD" ? undefined : content);
    } catch (e) {
      if (!res.headersSent)
        json(res, e.status || 500, {
          error: e.status
            ? e.message
            : "Something went wrong. Your saved workspace is still available.",
        });
      else res.end();
      if (!e.status)
        console.error(
          e.name,
          "Request failed; inspect the code or reproduce with the test suite.",
        );
    }
  });
  server.requestTimeout = 120000;
  server.headersTimeout = 20000;
  return { server, store };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const host = process.env.HOST || "127.0.0.1";
  if (
    !["127.0.0.1", "localhost", "::1"].includes(host) &&
    !process.env.WORKSPACE_PASSWORD
  )
    throw new Error(
      "Set WORKSPACE_PASSWORD before binding to a non-loopback address.",
    );
  const app = createApp();
  const port = Number(process.env.PORT || 3000);
  app.server.listen(port, host, () =>
    console.log(`Orbit is running at http://${host}:${port}`),
  );
  for (const sig of ["SIGINT", "SIGTERM"])
    process.on(sig, () =>
      app.server.close(() => {
        app.store.close();
        process.exit(0);
      }),
    );
}
