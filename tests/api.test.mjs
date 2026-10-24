import test from "node:test";
import {initialState} from "../server/fixtures.mjs";
import assert from "node:assert/strict";
import { createApp } from "../server/index.mjs";
import { handlers, runOne } from "../server/worker.mjs";
import { tokenCipher } from "../server/providers/mail/oauth.mjs";
test('unified mail API previews exact merge values, validates approval and exposes queue progress behind owner authentication',async t=>{
  const encryptionKey=Buffer.alloc(32,9).toString('base64'),w=await workspace(t,{WORKSPACE_PASSWORD:'owner',TOKEN_ENCRYPTION_KEY:encryptionKey,ENABLE_LIVE_SEND:'true'}),authorization={Authorization:'Basic '+Buffer.from('orbit:owner').toString('base64')};
  const state=initialState(false);Object.assign(state.profile,profile);state.contacts=[{id:'riley',name:'Riley Chen',email:'riley@company.com',company:'Company',title:'Recruiter',jobTitle:'Software Engineer',emailStatus:'verified',isDemo:false,suppressed:false}];await w.store.replace(state);
  await w.store.db.prepare('INSERT INTO mail_accounts(id,provider,email,secret,metadata) VALUES(?,?,?,?,?)').run('mail','google',profile.email,tokenCipher({TOKEN_ENCRYPTION_KEY:encryptionKey}).seal({access_token:'test',expires_at:Date.now()+3600000}),'{}');
  const draft={accountId:'mail',contactIds:['riley'],subject:'{{role}} at {{company}}',body:'Hello {{firstName}}, I use {{myTopSkill}}.',deliveryMode:'test'};
  assert.equal((await w.call('/api/outreach/preview',draft)).status,401);assert.equal((await w.call('/api/companies')).status,401);
  const review=await w.call('/api/outreach/preview',draft,'POST',authorization);assert.equal(review.status,200);assert.equal(review.json.messages[0].subject,'Software Engineer at Company');assert.match(review.json.messages[0].body,/Hello Riley/);
  const launch={campaignId:review.json.campaignId,previewId:review.json.previewId,confirmCount:1};assert.equal((await w.call('/api/outreach/launch',launch,'POST',authorization)).status,400);
  const [sent,repeated]=await Promise.all([w.call('/api/outreach/launch',{...launch,approved:true},'POST',authorization),w.call('/api/outreach/launch',{...launch,approved:true},'POST',authorization)]);assert.equal(sent.status,202);assert.equal(repeated.status,202);assert.equal(sent.json.progress.queued,1);assert.ok(sent.json.existing || repeated.json.existing);
  const again=await w.call('/api/outreach/launch',{...launch,approved:true},'POST',authorization);assert.equal(again.json.existing,true);
  const progress=await w.call(`/api/outreach/batches/${review.json.campaignId}`,undefined,'GET',authorization);assert.equal(progress.json.total,1);assert.equal(progress.json.sent,0);assert.equal(progress.json.queued,1);
  const paused=await w.call(`/api/outreach/batches/${review.json.campaignId}/pause`,{confirmed:true},'POST',authorization);assert.equal(paused.json.progress.status,'Paused');assert.equal(paused.json.progress.cancelled,1);
});

const profile = {
  name: "Casey Quinn",
  email: "casey@candidate.com",
  phone: "",
  headline: "Software engineer",
  location: "Bengaluru",
  portfolio: "",
  authorization: "",
  summary: "I build useful software.",
  skills: ["React", "SQL"],
  interests: ["Software engineer"],
  workMode: "Remote",
};
async function workspace(
  t,
  config = {},
  fetcher = async () => {
    throw Error("Unexpected external request");
  },
) {
  config={ENABLE_JOB_DISCOVERY:"false",...config};
  const app = createApp({ dataDir: ":memory:", config, fetcher });
  await app.ready;await app.store.replace(initialState(true));
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    app.server.closeAllConnections();
    await new Promise((resolve) => app.server.close(resolve));
    app.store.close();
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return {
    ...app,
    base,
    async call(
      path,
      data,
      method = data === undefined ? "GET" : "POST",
      headers = {},
    ) {
      const r = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(data === undefined ? {} : { "Content-Type": "application/json" }),
          ...headers,
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      const raw = await r.text();
      let json;
      try {
        json = JSON.parse(raw);
      } catch {}
      return { status: r.status, json, raw, headers: r.headers };
    },
    async work(id) {
      return runOne(
        app.store,
        app.queue,
        handlers(app.store, app.queue, config, fetcher),
        id,
      );
    },
  };
}
async function live(t, fetcher) {
  const w = await workspace(
    t,
    {
      ENABLE_LIVE_SEND: "true",
      RESEND_API_KEY: "TEST_ONLY",
      EMAIL_FROM: "casey@candidate.com",
    },
    fetcher,
  );
  await w.call("/api/workspace/reset", { confirm: "START_FRESH" });
  await w.call("/api/profile", profile, "PUT");
  await w.call("/api/contacts/import", {
    csv: "name,email,company,title,email_status\nRiley,hr@company.com,Company,Recruiter,verified",
  });
  await w.store.refresh();for(const c of w.store.state.contacts){c.emailStatus='verified';c.verification={provider:'Verified test fixture',status:'verified'};}await w.store.save();
  const s = (await w.call("/api/state")).json;
  const c = (
    await w.call("/api/campaigns", {
      name: "Hello",
      subject: "Hello {{first_name}}",
      body: "I am {{my_name}}.",
      contactIds: s.contacts.map((c) => c.id),
      attachResume: false,
    })
  ).json.campaign;
  return { ...w, campaign: c };
}

test("serves the React build and protects API state, credentials, origins, and server paths", async (t) => {
  const w = await workspace(t, { APOLLO_API_KEY: "never-expose" });
  assert.equal((await w.call("/")).status, 200);
  const state = await w.call("/api/state");
  assert.equal(state.status, 200);
  assert.equal(state.json.jobs.length, 12);
  assert.ok(!state.raw.includes("never-expose"));
  assert.ok(!("previews" in state.json));
  assert.match(
    (await w.call("/")).headers.get("content-security-policy"),
    /script-src 'self'/,
  );
  assert.equal(
    (
      await w.call("/api/profile", profile, "PUT", {
        Origin: "https://unrelated.com",
      })
    ).status,
    403,
  );
  assert.equal((await w.call("/server/index.mjs")).status, 404);
});
test("workspace password gates data and extension API requires its own expiring token", async (t) => {
  const w = await workspace(t, { WORKSPACE_PASSWORD: "test-owner-password" });
  assert.equal((await w.call("/api/state")).status, 401);
  const authorization = `Basic ${Buffer.from("orbit:test-owner-password").toString("base64")}`;
  assert.equal(
    (
      await w.call("/api/state", undefined, "GET", {
        Authorization: authorization,
      })
    ).status,
    200,
  );
  assert.equal((await w.call("/api/extension/next")).status, 401);
  const pairing = await w.call("/api/extension/token", {}, "POST", {
    Authorization: authorization,
  });
  assert.ok(pairing.json.token);
  const next = await w.call("/api/extension/next", undefined, "GET", {
    Authorization: `Bearer ${pairing.json.token}`,
  });
  assert.equal(next.status, 200);
  assert.equal(next.json.task, null);
});
test("résumé upload is quick and durable; the worker parses text and bytes stay out of state", async (t) => {
  const w = await workspace(t),
    body = "Casey Quinn\ncasey@candidate.com\n- Built React applications\nSQL";
  const upload = await w.call("/api/resume", {
    name: "resume.txt",
    base64: Buffer.from(body).toString("base64"),
  });
  assert.equal(upload.status, 202);
  assert.equal((await w.call("/api/state")).json.resume.parseStatus, "queued");
  assert.equal((await w.call("/api/state")).json.resume.text, "");
  const task = await w.work(upload.json.task.id);
  assert.equal(task.status, "completed");
  const state = (await w.call("/api/state")).json;
  assert.equal(state.resume.text, body);
  assert.deepEqual(state.resume.suggestions.skills, ["React", "SQL"]);
  assert.equal("base64" in state.resume, false);
  assert.equal((await w.call("/api/resume/download")).raw, body);
  assert.equal(
    (await w.call("/api/resume", { name: "bad.pdf", base64: "YWJj" })).status,
    400,
  );
});
test("batch preparation is atomic, deduplicates, and never regresses submitted stages", async (t) => {
  const w = await workspace(t),
    s = (await w.call("/api/state")).json,
    applied = s.applications.find((a) => a.stage === "Applied"),
    saved = s.applications.find((a) => a.stage === "Saved");
  assert.equal(
    (
      await w.call("/api/applications/batch", {
        jobIds: [applied.jobId, saved.jobId, saved.jobId],
      })
    ).json.count,
    2,
  );
  const next = (await w.call("/api/state")).json;
  assert.equal(
    next.applications.find((a) => a.id === applied.id).stage,
    "Applied",
  );
  assert.equal(next.applications.find((a) => a.id === saved.id).stage, "Ready");
  const count = next.applications.length;
  assert.equal(
    (
      await w.call("/api/applications/batch", {
        jobIds: ["missing", "sample-10"],
      })
    ).status,
    404,
  );
  assert.equal((await w.call("/api/state")).json.applications.length, count);
  assert.match(
    (await w.call(`/api/applications/${saved.id}/packet`)).raw,
    /does not submit/,
  );
});
test("job imports return queued tasks; the separate worker fetches, deduplicates, and caches", async (t) => {
  let calls = 0;
  const w = await workspace(t, {}, async () => {
    calls++;
    return new Response(
      JSON.stringify({
        jobs: [
          {
            id: 1,
            title: "Software Engineer",
            company_name: "Acme",
            url: "https://remotive.com/job/1",
            description: "React SQL",
            candidate_required_location: "Worldwide",
          },
        ],
      }),
    );
  });
  const queued = await w.call("/api/jobs/sync", { source: "Remotive" });
  assert.equal(queued.status, 202);
  assert.equal(calls, 0);
  await w.work(queued.json.task.id);
  assert.equal(calls, 1);
  assert.equal(
    (await w.call("/api/state")).json.jobs.find((j) => j.id === "remotive-1")
      .isDemo,
    false,
  );
  const again = await w.call("/api/jobs/sync", { source: "Remotive" });
  assert.equal(again.json.task.id, queued.json.task.id);
  assert.equal(
    (await w.call("/api/jobs/sync", { source: "Lever", board: "not-saved" }))
      .status,
    400,
  );
});
test("CSV import reports duplicates and invalid emails without silently verifying them", async (t) => {
  const w = await workspace(t);
  await w.call("/api/workspace/reset", { confirm: "START_FRESH" });
  const r = await w.call("/api/contacts/import", {
    csv: "name,email,company,email_status\nA,hello@company.com,Firm,verified\nB,hello@company.com,Firm,verified\nC,bad-email,Firm,verified\nD,new@company.com,Firm,",
  });
  assert.equal(r.json.imported, 2);
  assert.equal(r.json.skipped, 2);
  const contacts = (await w.call("/api/state")).json.contacts;
  assert.equal(contacts[0].source, "CSV");
  assert.equal(contacts[0].emailStatus, "unverified");
  assert.equal(contacts[1].emailStatus, "unverified");
});
test("campaign drafts contain actual attachments and send remains disabled without explicit setup", async (t) => {
  const w = await workspace(t),
    s = (await w.call("/api/state")).json,
    encoded = Buffer.from("Actual résumé").toString("base64");
  await w.call("/api/resume", { name: "resume.txt", base64: encoded });
  const c = (
    await w.call("/api/campaigns", {
      name: "Search",
      subject: "Hi {{first_name}}",
      body: "I am {{my_name}}.",
      contactIds: s.contacts.map((c) => c.id),
      attachResume: true,
    })
  ).json.campaign;
  const preview = (await w.call(`/api/campaigns/${c.id}/preview`, {})).json;
  assert.equal(preview.messages.length, 5);
  const draft = await w.call(
    `/api/campaigns/${c.id}/messages/${s.contacts[0].id}`,
  );
  assert.equal(draft.status, 200);
  assert.match(draft.raw, /X-Unsent: 1/);
  assert.ok(draft.raw.includes(encoded));
  assert.equal(
    (
      await w.call(`/api/campaigns/${c.id}/send`, {
        previewId: preview.previewId,
        approved: true,
        confirmCount: 5,
      })
    ).status,
    503,
  );
});
test("an approved campaign enters the outbox; only the worker calls the provider and duplicate queueing is blocked", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-10-19T09:00:00Z"),
  });
  const sent = [];
  const w = await live(t, async (url, options) => {
    sent.push({
      url,
      body: JSON.parse(options.body),
      key: options.headers["Idempotency-Key"],
    });
    return new Response(JSON.stringify({ id: "provider-id" }));
  });
  const cid = w.campaign.id,
    preview = (await w.call(`/api/campaigns/${cid}/preview`, {})).json;
  assert.equal(
    (
      await w.call(`/api/campaigns/${cid}/send`, {
        previewId: preview.previewId,
        approved: false,
        confirmCount: 1,
      })
    ).status,
    400,
  );
  const queued = await w.call(`/api/campaigns/${cid}/send`, {
    previewId: preview.previewId,
    approved: true,
    confirmCount: 1,
  });
  assert.equal(queued.status, 202);
  assert.equal(sent.length, 0);
  assert.equal(queued.json.deliveries[0].status, "queued");
  await w.work(queued.json.deliveries[0].taskId);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body.to, ["hr@company.com"]);
  assert.equal(
    (await w.call("/api/state")).json.campaigns[0].deliveries[0].status,
    "accepted",
  );
  assert.equal(
    (
      await w.call(`/api/campaigns/${cid}/send`, {
        previewId: preview.previewId,
        approved: true,
        confirmCount: 1,
      })
    ).status,
    202,
  );
});
test("profile edits invalidate approval and later suppression cancels queued messages before delivery", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-10-19T09:00:00Z"),
  });
  let sent = 0;
  const w = await live(t, async () => {
      sent++;
      return new Response("{}");
    }),
    cid = w.campaign.id,
    p = (await w.call(`/api/campaigns/${cid}/preview`, {})).json;
  await w.call("/api/profile", { ...profile, name: "Changed" }, "PUT");
  assert.equal(
    (
      await w.call(`/api/campaigns/${cid}/send`, {
        previewId: p.previewId,
        approved: true,
        confirmCount: 1,
      })
    ).status,
    409,
  );
  const fresh = (await w.call(`/api/campaigns/${cid}/preview`, {})).json,
    queued = await w.call(`/api/campaigns/${cid}/send`, {
      previewId: fresh.previewId,
      approved: true,
      confirmCount: 1,
    }),
    contact = (await w.call("/api/state")).json.contacts[0];
  await w.call(`/api/contacts/${contact.id}`, { suppressed: true }, "PATCH");
  const task = await w.work(queued.json.deliveries[0].taskId);
  assert.equal(task.status, "cancelled");
  assert.equal(sent, 0);
});
test("ambiguous provider acceptance is held rather than retried", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-10-19T09:00:00Z"),
  });
  let calls = 0;
  const w = await live(t, async () => {
      calls++;
      throw Error("network timeout");
    }),
    cid = w.campaign.id,
    p = (await w.call(`/api/campaigns/${cid}/preview`, {})).json,
    q = await w.call(`/api/campaigns/${cid}/send`, {
      previewId: p.previewId,
      approved: true,
      confirmCount: 1,
    });
  assert.equal((await w.work(q.json.deliveries[0].taskId)).status, "unknown");
  assert.equal(await w.work(q.json.deliveries[0].taskId), null);
  assert.equal(calls, 1);
});
test("follow-up sync detects a reply and cancels before sending a second message", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-10-19T09:00:00Z"),
  });
  let sends = 0;
  const cfg = {
    ENABLE_LIVE_SEND: "true",
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
  };
  const w = await workspace(t, cfg, async (url, opts) => {
    if (url.endsWith("/messages/send")) {
      sends++;
      return new Response(
        JSON.stringify({ id: "sent-1", threadId: "thread-1" }),
      );
    }
    if (url.endsWith("/profile"))
      return new Response(JSON.stringify({ historyId: "100" }));
    if (url.includes("/messages?"))
      return new Response(JSON.stringify({ messages: [{ id: "reply-1" }] }));
    return new Response(
      JSON.stringify({
        id: "reply-1",
        threadId: "thread-1",
        internalDate: String(Date.now()),
        labelIds: ["INBOX"],
        payload: {
          mimeType: "text/plain",
          headers: [
            { name: "From", value: "hr@company.com" },
            { name: "Subject", value: "Re: Hello" },
          ],
          body: {
            data: Buffer.from("Happy to chat tomorrow.").toString("base64url"),
          },
        },
      }),
    );
  });
  await w.call("/api/workspace/reset", { confirm: "START_FRESH" });
  await w.call("/api/profile", profile, "PUT");
  await w.call("/api/contacts/import", {
    csv: "name,email,company,email_status\nRiley,hr@company.com,Company,verified",
  });
  await w.store.refresh();for(const c of w.store.state.contacts){c.emailStatus='verified';c.verification={provider:'Verified test fixture',status:'verified'};}await w.store.save();
  w.store.db
    .prepare(
      "INSERT INTO mail_accounts(id,provider,email,secret,metadata) VALUES(?,?,?,?,?)",
    )
    .run(
      "a",
      "google",
      profile.email,
      tokenCipher(cfg).seal({
        access_token: "test",
        refresh_token: "test",
        expires_at: Date.now() + 10 * 86400000,
      }),
      "{}",
    );
  const contacts = (await w.call("/api/state")).json.contacts,
    c = (
      await w.call("/api/campaigns", {
        name: "Sequence",
        subject: "Hello",
        body: "A thoughtful introduction.",
        contactIds: [contacts[0].id],
        accountId: "a",
        sequence: {
          enabled: true,
          afterBusinessDays: 4,
          body: "Just following up.",
        },
      })
    ).json.campaign,
    p = (await w.call(`/api/campaigns/${c.id}/preview`, {})).json,
    q = await w.call(`/api/campaigns/${c.id}/send`, {
      previewId: p.previewId,
      approved: true,
      confirmCount: 1,
    });
  await w.work(q.json.deliveries[0].taskId);
  const delivery = (await w.call("/api/state")).json.campaigns[0].deliveries[0];
  assert.ok(delivery.followupTaskId);
  t.mock.timers.setTime(Date.parse("2026-10-23T09:00:00Z"));
  const result = await w.work(delivery.followupTaskId);
  assert.equal(result.status, "cancelled");
  assert.equal(sends, 1);
  assert.ok(
    (await w.call("/api/state")).json.campaigns[0].deliveries[0].repliedAt,
  );
});
test("imported email suggestions stay in review until accepted and can be applied only once", async (t) => {
  const w = await workspace(t),
    a = (await w.call("/api/state")).json.applications[0];
  const item = (
    await w.call("/api/inbox/analyze", {
      applicationId: a.id,
      subject: "Interview invitation",
      body: "Please schedule your interview.",
    })
  ).json.item;
  assert.equal(
    (await w.call("/api/state")).json.applications.find((x) => x.id === a.id)
      .stage,
    a.stage,
  );
  await w.call(`/api/inbox/${item.id}/accept`, {});
  assert.equal(
    (await w.call("/api/state")).json.applications.find((x) => x.id === a.id)
      .stage,
    "Interview",
  );
  assert.equal((await w.call(`/api/inbox/${item.id}/accept`, {})).status, 409);
});
test("browser assistant is bearer-scoped, destination-checked, and cannot report a submission", async (t) => {
  const w = await workspace(t);
  assert.equal(
    (await w.call("/api/apply/queue", { approved: true, jobIds: ["sample-1"] }))
      .status,
    400,
  );
  await w.call("/api/workspace/reset", { confirm: "START_FRESH" });
  await w.call("/api/profile", profile, "PUT");
  const j = (
    await w.call("/api/jobs/manual", {
      title: "Software Engineer",
      company: "Acme",
      url: "https://boards.greenhouse.io/acme/jobs/1",
    })
  ).json.job;
  await w.call("/api/apply/queue", { approved: true, jobIds: [j.id] });
  const token = (await w.call("/api/extension/token", {})).json.token,
    headers = { Authorization: `Bearer ${token}` },
    next = (await w.call("/api/extension/next", undefined, "GET", headers)).json
      .task;
  assert.ok(next.profile);
  assert.equal(
    (
      await w.call(
        "/api/extension/report",
        { taskId: next.id, status: "Applied" },
        "POST",
        headers,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await w.call(
        "/api/extension/report",
        {
          taskId: next.id,
          status: "needs-review",
          missing: ["Work eligibility"],
        },
        "POST",
        headers,
      )
    ).status,
    200,
  );
  let s = (await w.call("/api/state")).json;
  assert.equal(s.applications.find((a) => a.jobId === j.id).stage, "Ready");
  await w.call(`/api/apply/${next.id}/confirm`, {
    confirmationReference: "Employer receipt #123",
  });
  s = (await w.call("/api/state")).json;
  assert.equal(s.applications.find((a) => a.jobId === j.id).stage, "Applied");
});
test("public résumé links are approved, revocable, file-bound, and expire independently of owner access", async (t) => {
  const w = await workspace(t),
    file = Buffer.from("Private résumé").toString("base64");
  await w.call("/api/resume", { name: "r.txt", base64: file });
  assert.equal(
    (await w.call("/api/share/resume", { approved: false })).status,
    400,
  );
  const link = (await w.call("/api/share/resume", { approved: true })).json.url,
    path = new URL(link).pathname;
  assert.equal((await w.call(path)).raw, "Private résumé");
  const info = (await w.call("/api/vault")).json.links[0];
  await w.call(`/api/share/${info.id}/revoke`, {});
  assert.equal((await w.call(path)).status, 404);
  assert.equal((await w.call("/api/resume/download")).status, 200);
});
test("mail tokens are never returned and Graph notifications require stored clientState", async (t) => {
  const config = {
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
    },
    w = await workspace(t, config);
  w.store.db
    .prepare(
      "INSERT INTO mail_accounts(id,provider,email,secret,metadata) VALUES(?,?,?,?,?)",
    )
    .run(
      "a",
      "microsoft",
      "me@candidate.com",
      tokenCipher(config).seal({
        access_token: "never-return-this",
        notificationSecret: "expected-state",
      }),
      JSON.stringify({ subscriptionId: "subscription-1" }),
    );
  const accounts = await w.call("/api/mail/accounts");
  assert.ok(!accounts.raw.includes("never-return-this"));
  assert.equal(
    (
      await w.call("/api/webhooks/microsoft", {
        value: [{ subscriptionId: "subscription-1", clientState: "wrong" }],
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await w.call("/api/webhooks/microsoft", {
        value: [
          { subscriptionId: "subscription-1", clientState: "expected-state" },
        ],
      })
    ).status,
    202,
  );
  assert.equal(
    (await w.call("/api/webhooks/gmail", { message: { data: "abc" } })).status,
    503,
  );
});

test('SSE requires workspace authentication and streams completed worker tasks', async t => {
  const w=await workspace(t,{WORKSPACE_PASSWORD:'events-test-password'});
  assert.equal((await w.call('/api/events')).status,401);
  const headers={Authorization:`Basic ${Buffer.from('orbit:events-test-password').toString('base64')}`};
  const controller=new AbortController();
  t.after(()=>controller.abort());
  const stream=await fetch(`${w.base}/api/events`,{headers,signal:controller.signal});
  assert.equal(stream.headers.get('content-type'),'text/event-stream; charset=utf-8');
  const reader=stream.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value),/event: ready/);
  const task=w.queue.enqueue('test.complete',{});
  await runOne(w.store,w.queue,{'test.complete':async()=>({count:1})},task.id);
  let output='';
  const deadline=AbortSignal.timeout(6000);
  while(!output.includes(task.id)) {
    const chunk=await Promise.race([reader.read(),new Promise((_,reject)=>deadline.addEventListener('abort',()=>reject(Error('SSE task event timed out')),{once:true}))]);
    output+=new TextDecoder().decode(chunk.value);
  }
  assert.match(output,/event: task/);assert.match(output,/"status":"completed"/);
  controller.abort();
});
test('extension submit attempts stay pending until a matching ATS confirmation is reported',async t=>{
  const w=await workspace(t);
  await w.call('/api/workspace/reset',{confirm:'START_FRESH'});
  await w.call('/api/profile',profile,'PUT');
  const job=(await w.call('/api/jobs/manual',{title:'Engineer',company:'Acme',url:'https://boards.greenhouse.io/acme/jobs/99'})).json.job;
  await w.call('/api/apply/queue',{approved:true,jobIds:[job.id]});
  const token=(await w.call('/api/extension/token',{})).json.token,headers={Authorization:`Bearer ${token}`};
  const task=(await w.call('/api/extension/next',undefined,'GET',headers)).json.task;
  const report={taskId:task.id,url:job.url,status:'confirmed',evidence:'Your application has been received. Thank you for applying.'};
  assert.equal((await w.call('/api/extension/submission',report,'POST',headers)).status,409);
  assert.equal((await w.call('/api/extension/submission',{...report,status:'submission-pending'},'POST',headers)).status,200);
  assert.equal((await w.call('/api/state')).json.applications[0].stage,'Ready');
  assert.equal((await w.call('/api/extension/submission',{...report,url:'https://other.greenhouse.io/wrong'},'POST',headers)).status,400);
  assert.equal((await w.call('/api/extension/submission',report,'POST',headers)).status,200);
  assert.equal((await w.call('/api/state')).json.applications[0].stage,'Applied');
});
test('outreach sends opt-out headers, GET cannot unsubscribe, and one-click POST suppresses future mail',async t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-19T09:00:00Z')});
  let message;
  const w=await live(t,async(url,options)=>{message=JSON.parse(options.body);return new Response(JSON.stringify({id:'mock-only'}));});
  const p=(await w.call(`/api/campaigns/${w.campaign.id}/preview`,{})).json;
  const q=await w.call(`/api/campaigns/${w.campaign.id}/send`,{previewId:p.previewId,approved:true,confirmCount:1});
  await w.work(q.json.deliveries[0].taskId);
  assert.match(message.headers['List-Unsubscribe'],/^<http:\/\/127\.0\.0\.1:3000\/u\/[\w-]{43}>$/);
  assert.equal(message.headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');
  const link=new URL(message.headers['List-Unsubscribe'].slice(1,-1));
  assert.equal((await fetch(w.base+link.pathname)).status,200);
  assert.equal((await w.call('/api/state')).json.contacts[0].suppressed,false);
  const r=await fetch(w.base+link.pathname,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'List-Unsubscribe=One-Click'});
  assert.equal(r.status,200);assert.equal((await w.call('/api/state')).json.contacts[0].suppressed,true);
  const ledger=w.store.db.prepare('SELECT * FROM outreach_send_log').get();
  assert.equal(ledger.status,'accepted');
  assert.throws(()=>w.store.db.prepare("INSERT INTO outreach_send_log(user_id,contact_email,campaign_id,sequence_step,task_id,status,updated_at) VALUES(?,?,?,?,?,'queued',?)").run('local',ledger.contact_email,ledger.campaign_id,0,'duplicate',Date.now()),/UNIQUE/);
});

test('browser contact import accepts 100 profiles behind owner or extension auth, binds results to the importing token and rejects mismatched profile pages',async t=>{
  const w=await workspace(t,{WORKSPACE_PASSWORD:'owner'}),owner={Authorization:'Basic '+Buffer.from('orbit:owner').toString('base64')};await w.store.replace(initialState(false));
  const profiles=Array.from({length:60},(_,i)=>({fullName:`Maya Person${String.fromCharCode(65+Math.floor(i/26))}${String.fromCharCode(65+i%26)}`,profileUrl:`https://www.linkedin.com/in/person-${i}`,title:'Director of Finance'})),data={company:'Company',domain:'company.com',domainConfirmed:true,sourceUrl:'https://www.linkedin.com/company/company/people/',profiles};
  assert.equal((await w.call('/api/contacts/import-browser-profiles',data)).status,401);
  const token=(await w.call('/api/extension/token',{},'POST',owner)).json.token,headers={Authorization:`Bearer ${token}`};
  const imported=await w.call('/api/contacts/import-browser-profiles',data,'POST',headers);assert.equal(imported.status,202);assert.equal(imported.json.count,60);
  const repeat=await w.call('/api/contacts/import-browser-profiles',data,'POST',headers);assert.equal(repeat.json.taskId,imported.json.taskId);
  const status=await w.call('/api/extension/contact-result',{taskId:imported.json.taskId},'POST',headers);assert.equal(status.status,200);assert.equal(status.json.status,'queued');
  const other=(await w.call('/api/extension/token',{},'POST',owner)).json.token;assert.equal((await w.call('/api/extension/contact-result',{taskId:imported.json.taskId},'POST',{Authorization:`Bearer ${other}`})).status,404);
  assert.equal((await w.call('/api/contacts/import-browser-profiles',{...data,profiles:Array(101).fill(profiles[0])},'POST',owner)).status,400);
  assert.equal((await w.call('/api/contacts/import-browser-profiles',{...data,sourceUrl:'https://www.linkedin.com/in/someone-else',profiles:[profiles[0]]},'POST',owner)).status,400);
  assert.equal((await w.call('/api/contacts/import-browser-profiles',{...data,sourceUrl:'https://evil.test/people'},'POST',owner)).status,400);
  assert.equal(w.store.state.campaigns.length,0);
});

test('Get email returns saved suggestions and alternates immediately while the verification worker is still queued',async t=>{
  const w=await workspace(t,{WORKSPACE_PASSWORD:'owner'},async input=>{assert.equal(new URL(input).hostname,'dns.google');return new Response(JSON.stringify({Status:0,Answer:[{type:15,data:'10 mx.deloitte.com.'}]}));}),owner={Authorization:'Basic '+Buffer.from('orbit:owner').toString('base64')};await w.store.replace(initialState(false));
  const token=(await w.call('/api/extension/token',{},'POST',owner)).json.token,headers={Authorization:`Bearer ${token}`},body={company:'Deloitte',sourceUrl:'https://www.linkedin.com/in/maya-singh',profiles:[{fullName:'Maya Singh',title:'Director of Finance',profileUrl:'https://www.linkedin.com/in/maya-singh'}]};
  const response=await w.call('/api/contacts/import-browser-profiles',body,'POST',headers);assert.equal(response.status,202);assert.equal(response.json.status,'queued');assert.equal(response.json.contacts[0].email,'maya.singh@deloitte.com');assert.ok(response.json.contacts[0].alternateEmails.includes('msingh@deloitte.com'));assert.equal(response.json.contacts[0].emailStatus,'unverified');assert.ok(response.json.contacts[0].domainVerification.hasMx);assert.equal((await w.queue.get(response.json.taskId)).status,'queued');
  const context=await w.call('/api/extension/contact-context',{company:'Deloitte'},'POST',headers);assert.equal(context.json.domain,'deloitte.com');assert.equal(context.json.requiresDomainReview,false);assert.equal(w.store.state.campaigns.length,0);
});
