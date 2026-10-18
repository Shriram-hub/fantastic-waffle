import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchJobs,
  searchApollo,
  enrichApollo,
  boardList,
  sendResend,
} from "../server/providers.mjs";

const response = (data) => new Response(JSON.stringify(data), { status: 200 });
test("job adapters normalize documented Remotive, Greenhouse, and Lever response shapes", async () => {
  const remotive = await fetchJobs("Remotive", "", async (url) => {
    assert.equal(url, "https://remotive.com/api/remote-jobs");
    return response({
      jobs: [
        {
          id: 1,
          company_name: "Acme",
          title: "Engineer",
          candidate_required_location: "Worldwide",
          description: "<p>React engineer</p>",
          tags: ["React"],
          url: "https://remotive.com/job/1",
        },
      ],
    });
  });
  assert.equal(remotive[0].workMode, "Remote");
  assert.equal(remotive[0].description, "React engineer");
  assert.equal(remotive[0].isDemo, false);
  const greenhouse = await fetchJobs("Greenhouse", "acme", async (url) => {
    assert.match(url, /\/boards\/acme\/jobs\?content=true$/);
    return response({
      jobs: [
        {
          id: 2,
          title: "Engineer",
          location: { name: "Remote, India" },
          content: "<p>TypeScript</p>",
          absolute_url: "https://boards.greenhouse.io/acme/jobs/2",
          departments: [{ name: "Engineering" }],
        },
      ],
    });
  });
  assert.equal(greenhouse[0].id, "greenhouse-acme-2");
  assert.equal(greenhouse[0].workMode, "Remote");
  const lever = await fetchJobs("Lever", "acme", async (url) => {
    assert.match(url, /\/postings\/acme\?mode=json$/);
    return response([
      {
        id: "abc",
        text: "Designer",
        categories: { location: "Mumbai", commitment: "Full-time" },
        workplaceType: "hybrid",
        applyUrl: "https://jobs.lever.co/acme/abc/apply",
        descriptionPlain: "Design products",
        lists: [{ text: "Skills", content: "<li>Figma</li>" }],
      },
    ]);
  });
  assert.equal(lever[0].workMode, "Hybrid");
  assert.match(lever[0].description, /Figma/);
});
test("job sources reject arbitrary hosts, invalid slugs, and malformed provider responses", async () => {
  assert.throws(() => boardList(["../private"]), /slugs/);
  assert.throws(
    () => boardList(Array.from({ length: 11 }, (_, i) => `b${i}`)),
    /slugs/,
  );
  await assert.rejects(
    fetchJobs("Arbitrary", "https://internal"),
    /Unsupported/,
  );
  await assert.rejects(fetchJobs("Lever", "a/b"), /valid/);
  await assert.rejects(
    fetchJobs("Greenhouse", "acme", async () => response({ notJobs: [] })),
    /unexpected response/,
  );
  await assert.rejects(
    fetchJobs("Remotive", "", async () => {
      throw Error("network");
    }),
    /could not be reached/,
  );
});
test("Apollo search and enrichment are separate; search never treats masked data as a sendable email", async () => {
  let calls = 0;
  const fetcher = async (url, opts) => {
    calls++;
    assert.equal(opts.headers["X-Api-Key"], "server-only");
    const body = JSON.parse(opts.body);
    if (url.includes("api_search")) {
      assert.deepEqual(body.person_titles, ["Recruiter"]);
      assert.deepEqual(body.q_organization_domains_list, ["acme.com"]);
      return response({
        people: [
          {
            id: "p1",
            first_name: "Alex",
            last_name_obfuscated: "S.",
            title: "Recruiter",
            organization: { name: "Acme" },
            email: "masked@acme.com",
          },
        ],
      });
    }
    assert.equal(body.id, "p1");
    assert.equal(body.reveal_personal_emails, false);
    assert.equal(body.reveal_phone_number, false);
    return response({
      person: {
        name: "Alex Smith",
        email: "alex@acme.com",
        email_status: "verified",
      },
    });
  };
  const [person] = await searchApollo(
    { domain: "acme.com", titles: "Recruiter" },
    "server-only",
    fetcher,
  );
  assert.equal(person.email, "");
  assert.equal(calls, 1);
  const enriched = await enrichApollo(person, "server-only", fetcher);
  assert.equal(calls, 2);
  assert.equal(enriched.emailStatus, "verified");
  await assert.rejects(
    searchApollo({ domain: "acme.com" }, ""),
    /APOLLO_API_KEY/,
  );
});
test("Resend acceptance, rejection, and ambiguous responses have different durable statuses", async () => {
  const cfg = { EMAIL_FROM: "me@candidate.com", RESEND_API_KEY: "secret" },
    msg = {
      to: "hr@acme.com",
      subject: "Hello",
      body: "Hi",
      replyTo: "me@candidate.com",
    };
  const result = await sendResend(
    msg,
    cfg,
    null,
    "idempotency",
    async (url, opts) => {
      assert.equal(opts.headers["Idempotency-Key"], "idempotency");
      assert.deepEqual(JSON.parse(opts.body).to, ["hr@acme.com"]);
      return response({ id: "provider-1" });
    },
  );
  assert.equal(result.status, "accepted");
  assert.equal(
    (
      await sendResend(
        msg,
        cfg,
        null,
        "k",
        async () => new Response("{}", { status: 429 }),
      )
    ).status,
    "failed",
  );
  assert.equal(
    (
      await sendResend(
        msg,
        cfg,
        null,
        "k",
        async () => new Response("{}", { status: 503 }),
      )
    ).status,
    "unknown",
  );
  assert.equal(
    (
      await sendResend(msg, cfg, null, "k", async () => {
        throw Error("timeout");
      })
    ).status,
    "unknown",
  );
});
