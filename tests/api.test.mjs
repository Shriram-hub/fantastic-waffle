import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/index.mjs";
import { openStore } from "../server/store.mjs";

async function workspace(
  t,
  config = {},
  fetcher = async () => {
    throw Error("Unexpected external request");
  },
) {
  const app = createApp({ dataDir: ":memory:", config, fetcher });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    app.server.closeAllConnections();
    await new Promise((resolve) => app.server.close(resolve));
    app.store.close();
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (
    path,
    data,
    method = data === undefined ? "GET" : "POST",
    headers = {},
  ) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(data === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const raw = await response.text();
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      /* Downloads are text or binary. */
    }
    return { status: response.status, headers: response.headers, raw, json };
  };
  return { ...app, call };
}
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
async function liveWorkspace(t, fetcher) {
  const w = await workspace(
    t,
    {
      RESEND_API_KEY: "TEST_ONLY",
      EMAIL_FROM: "casey@candidate.com",
      ENABLE_LIVE_SEND: "true",
    },
    fetcher,
  );
  await w.call("/api/workspace/reset", { confirm: "START_FRESH" });
  await w.call("/api/profile", profile, "PUT");
  await w.call("/api/contacts/import", {
    csv: "name,email,company,title,email_status\nRiley,hr@company.com,Company,Recruiter,verified",
  });
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

test("serves the interface and protects state, origins, file paths, and API secrets", async (t) => {
  const { call } = await workspace(t, { APOLLO_API_KEY: "never-expose-this" });
  const home = await call("/");
  assert.equal(home.status, 200);
  assert.match(home.raw, /Orbit/);
  assert.match(
    home.headers.get("content-security-policy"),
    /script-src 'self'/,
  );
  assert.equal((await call("/styles.css")).status, 200);
  assert.equal((await call("/app.js")).status, 200);
  const state = await call("/api/state");
  assert.ok(state.json.isDemo);
  assert.equal(state.json.jobs.length, 12);
  assert.equal("previews" in state.json, false);
  assert.ok(!state.raw.includes("never-expose-this"));
  assert.equal(
    (
      await call("/api/profile", profile, "PUT", {
        Origin: "https://unrelated-site.com",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/api/profile", profile, "PUT", {
        "Sec-Fetch-Site": "cross-site",
      })
    ).status,
    403,
  );
  assert.equal((await call("/server/index.mjs")).status, 404);
  assert.equal((await call("/api/missing")).status, 404);
});
test("optional workspace password gates both UI and data", async (t) => {
  const { call } = await workspace(t, {
    WORKSPACE_PASSWORD: "a-strong-test-password",
  });
  assert.equal((await call("/")).status, 401);
  assert.equal(
    (
      await call("/api/state", undefined, "GET", {
        Authorization: `Basic ${Buffer.from("orbit:wrong").toString("base64")}`,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await call("/api/state", undefined, "GET", {
        Authorization: `Basic ${Buffer.from("orbit:a-strong-test-password").toString("base64")}`,
      })
    ).status,
    200,
  );
});
test("profile and résumé changes persist in SQLite across restarts and files remain private", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let store = openStore(dir);
  store.state.profile = profile;
  store.save();
  store.close();
  store = openStore(dir);
  assert.equal(store.state.profile.name, "Casey Quinn");
  store.close();
  const { call } = await workspace(t);
  assert.equal((await call("/api/profile", profile, "PUT")).status, 200);
  assert.equal(
    (await call("/api/profile", { ...profile, email: "invalid" }, "PUT"))
      .status,
    400,
  );
  const content = "Casey Quinn\ncasey@candidate.com\nReact SQL";
  const result = await call("/api/resume", {
    name: "resume.txt",
    base64: Buffer.from(content).toString("base64"),
  });
  assert.equal(result.status, 200);
  const state = (await call("/api/state")).json;
  assert.equal(state.resume.text, content);
  assert.equal("base64" in state.resume, false);
  assert.deepEqual(state.profile.skills, ["React", "SQL"]);
  assert.equal((await call("/api/resume/download")).raw, content);
  await call("/api/resume", {}, "DELETE");
  assert.equal((await call("/api/resume/download")).status, 404);
});
test("batch preparation deduplicates, keeps submitted stages, and never claims to submit", async (t) => {
  const { call } = await workspace(t);
  const s = (await call("/api/state")).json;
  const applied = s.applications.find((a) => a.stage === "Applied"),
    saved = s.applications.find((a) => a.stage === "Saved");
  const result = await call("/api/applications/batch", {
    jobIds: [applied.jobId, saved.jobId, saved.jobId],
  });
  assert.equal(result.json.count, 2);
  const next = (await call("/api/state")).json;
  assert.equal(
    next.applications.find((a) => a.id === applied.id).stage,
    "Applied",
  );
  assert.equal(next.applications.find((a) => a.id === saved.id).stage, "Ready");
  const packet = await call(`/api/applications/${saved.id}/packet`);
  assert.match(packet.raw, /does not submit an application/);
  const same = await call("/api/applications", {
    jobId: applied.jobId,
    stage: "Saved",
  });
  assert.ok(same.json.existing);
  assert.equal(same.json.application.stage, "Applied");
  assert.equal(
    (
      await call(
        `/api/applications/${saved.id}`,
        { stage: "Invented" },
        "PATCH",
      )
    ).status,
    400,
  );
  const before = next.applications.length;
  assert.equal(
    (
      await call("/api/applications/batch", {
        jobIds: ["missing", "sample-10"],
      })
    ).status,
    404,
  );
  assert.equal((await call("/api/state")).json.applications.length, before);
});
test("manual jobs validate URLs and export CSV neutralizes formula cells", async (t) => {
  const { call } = await workspace(t);
  assert.equal(
    (
      await call("/api/jobs/manual", {
        title: "Role",
        company: "Co",
        url: "javascript:alert(1)",
      })
    ).status,
    400,
  );
  const job = (
    await call("/api/jobs/manual", {
      title: "=danger",
      company: "+formula",
      url: "https://company.com/careers/1",
      workMode: "Remote",
    })
  ).json.job;
  await call("/api/applications", { jobId: job.id });
  const exported = await call("/api/export/applications");
  assert.match(exported.raw, /"'\+formula"/);
  assert.match(exported.raw, /"'=danger"/);
});
test("contact import skips malformed rows and duplicates, with explicit verification provenance", async (t) => {
  const { call } = await workspace(t);
  await call("/api/workspace/reset", { confirm: "START_FRESH" });
  const result = await call("/api/contacts/import", {
    csv: "name,email,company,email_status\nA,hello@company.com,Firm,verified\nB,hello@company.com,Firm,verified\nC,not-an-email,Firm,verified\nD,new@company.com,Firm,",
  });
  assert.equal(result.json.imported, 2);
  assert.equal(result.json.skipped, 2);
  const contacts = (await call("/api/state")).json.contacts;
  assert.equal(contacts[0].source, "CSV");
  assert.equal(contacts[1].emailStatus, "unverified");
  assert.equal(
    (await call("/api/contacts/apollo/search", { domain: "company.com" }))
      .status,
    503,
  );
});
test("campaign preview creates personalized draft downloads with the actual résumé attachment and no send", async (t) => {
  const { call } = await workspace(t);
  const s = (await call("/api/state")).json;
  const attachment = Buffer.from("My actual résumé").toString("base64");
  await call("/api/resume", { name: "my-resume.txt", base64: attachment });
  const c = (
    await call("/api/campaigns", {
      name: "Job search",
      subject: "Hello {{first_name}}",
      body: "I am {{my_name}}. Here are my skills: {{skills}}",
      contactIds: s.contacts.map((c) => c.id),
      attachResume: true,
    })
  ).json.campaign;
  const preview = await call(`/api/campaigns/${c.id}/preview`, {});
  assert.equal(preview.json.messages.length, 5);
  assert.equal(preview.json.attachment.name, "my-resume.txt");
  const draft = await call(
    `/api/campaigns/${c.id}/messages/${s.contacts[0].id}`,
  );
  assert.equal(draft.status, 200);
  assert.match(draft.raw, /X-Unsent: 1/);
  assert.ok(draft.raw.includes(attachment));
  assert.equal(
    (
      await call(`/api/campaigns/${c.id}/send`, {
        approved: true,
        confirmCount: 5,
        previewId: preview.json.previewId,
      })
    ).status,
    503,
  );
  assert.equal(
    (await call("/api/state")).json.campaigns[0].deliveries.length,
    0,
  );
});
test("reviewed email suggestions do not change the tracker until accepted", async (t) => {
  const { call } = await workspace(t);
  const s = (await call("/api/state")).json,
    a = s.applications[0];
  const item = (
    await call("/api/inbox/analyze", {
      applicationId: a.id,
      subject: "Interview invitation",
      from: "Hiring team",
      body: "We would like to schedule your interview.",
    })
  ).json.item;
  assert.equal(item.proposedStage, "Interview");
  assert.equal(
    (await call("/api/state")).json.applications.find((x) => x.id === a.id)
      .stage,
    a.stage,
  );
  assert.equal((await call(`/api/inbox/${item.id}/accept`, {})).status, 200);
  assert.equal(
    (await call("/api/state")).json.applications.find((x) => x.id === a.id)
      .stage,
    "Interview",
  );
  assert.equal((await call(`/api/inbox/${item.id}/accept`, {})).status, 409);
});
test("job synchronization uses the adapter, caches refreshes, and records source errors", async (t) => {
  let calls = 0;
  const { call } = await workspace(t, {}, async () => {
    calls++;
    return new Response(
      JSON.stringify({
        jobs: [
          {
            id: 1,
            title: "Engineer",
            company_name: "Real Co",
            url: "https://remotive.com/job/1",
            description: "React SQL",
          },
        ],
      }),
    );
  });
  assert.equal(
    (await call("/api/jobs/sync", { source: "Remotive" })).json.count,
    1,
  );
  assert.ok((await call("/api/jobs/sync", { source: "Remotive" })).json.cached);
  assert.equal(calls, 1);
  assert.equal(
    (await call("/api/state")).json.jobs.find((j) => j.id === "remotive-1")
      .isDemo,
    false,
  );
  assert.equal(
    (await call("/api/jobs/sync", { source: "Lever", board: "not-saved" }))
      .status,
    400,
  );
});
test("live send requires a current preview and reviewed count; accepted messages cannot be sent twice", async (t) => {
  const sent = [];
  const w = await liveWorkspace(t, async (url, opts) => {
    sent.push({
      url,
      body: JSON.parse(opts.body),
      key: opts.headers["Idempotency-Key"],
    });
    return new Response(JSON.stringify({ id: "resend-message" }));
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
  const result = await w.call(`/api/campaigns/${cid}/send`, {
    previewId: preview.previewId,
    approved: true,
    confirmCount: 1,
  });
  assert.equal(result.status, 200);
  assert.equal(result.json.deliveries[0].status, "accepted");
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body.to, ["hr@company.com"]);
  assert.equal(
    (
      await w.call(`/api/campaigns/${cid}/send`, {
        previewId: preview.previewId,
        approved: true,
        confirmCount: 1,
      })
    ).status,
    409,
  );
  assert.equal(sent.length, 1);
});
test("changing recipients or the profile invalidates previous send approval", async (t) => {
  const w = await liveWorkspace(t, async () => {
    throw Error("Must not send");
  });
  const cid = w.campaign.id;
  const preview = (await w.call(`/api/campaigns/${cid}/preview`, {})).json;
  await w.call("/api/profile", { ...profile, name: "Changed Name" }, "PUT");
  assert.equal(
    (
      await w.call(`/api/campaigns/${cid}/send`, {
        previewId: preview.previewId,
        approved: true,
        confirmCount: 1,
      })
    ).status,
    409,
  );
  const fresh = (await w.call(`/api/campaigns/${cid}/preview`, {})).json;
  const contact = (await w.call("/api/state")).json.contacts[0];
  await w.call(`/api/contacts/${contact.id}`, { suppressed: true }, "PATCH");
  assert.equal(
    (
      await w.call(`/api/campaigns/${cid}/send`, {
        previewId: fresh.previewId,
        approved: true,
        confirmCount: 1,
      })
    ).status,
    409,
  );
});
test("draft editing invalidates the old preview and preserves a single campaign", async (t) => {
  const w = await liveWorkspace(t, async () => {
    throw Error("Must not send");
  });
  const cid = w.campaign.id;
  const preview = (await w.call(`/api/campaigns/${cid}/preview`, {})).json;
  const updated = await w.call(
    `/api/campaigns/${cid}`,
    { ...w.campaign, body: "A different message" },
    "PATCH",
  );
  assert.equal(updated.status, 200);
  assert.equal(
    (
      await w.call(`/api/campaigns/${cid}/send`, {
        previewId: preview.previewId,
        approved: true,
        confirmCount: 1,
      })
    ).status,
    409,
  );
  assert.equal((await w.call("/api/state")).json.campaigns.length, 1);
});
test("concurrent send requests cannot bypass the workspace send lock", async (t) => {
  let release, started;
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let sent = 0;
  const w = await liveWorkspace(t, async () => {
    sent++;
    started();
    await gate;
    return new Response(JSON.stringify({ id: "one-send-only" }));
  });
  const cid = w.campaign.id,
    preview = (await w.call(`/api/campaigns/${cid}/preview`, {})).json,
    request = { previewId: preview.previewId, approved: true, confirmCount: 1 };
  const first = w.call(`/api/campaigns/${cid}/send`, request);
  await entered;
  const second = await w.call(`/api/campaigns/${cid}/send`, request);
  assert.equal(second.status, 409);
  release();
  assert.equal((await first).status, 200);
  assert.equal(sent, 1);
});
test("ambiguous sends survive restarts as unknown and are not automatically retried", async (t) => {
  const w = await liveWorkspace(t, async () => {
    throw Error("Network timed out");
  });
  const cid = w.campaign.id,
    preview = (await w.call(`/api/campaigns/${cid}/preview`, {})).json;
  const result = await w.call(`/api/campaigns/${cid}/send`, {
    previewId: preview.previewId,
    approved: true,
    confirmCount: 1,
  });
  assert.equal(result.json.deliveries[0].status, "unknown");
  assert.equal(
    (
      await w.call(`/api/campaigns/${cid}/send`, {
        previewId: preview.previewId,
        approved: true,
        confirmCount: 1,
      })
    ).status,
    409,
  );
  const dir = mkdtempSync(join(tmpdir(), "orbit-restart-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let store = openStore(dir);
  store.state.campaigns.push({
    id: "c",
    deliveries: [{ contactId: "a", status: "sending" }],
  });
  store.save();
  store.close();
  store = openStore(dir);
  assert.equal(store.state.campaigns[0].deliveries[0].status, "unknown");
  store.close();
});
