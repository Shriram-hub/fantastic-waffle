import test from "node:test";
import assert from "node:assert/strict";
import {openStore as openEmptyStore} from "../server/store.mjs";
const openStore=path=>{const s=openEmptyStore(path);s.replace(initialState(true));return s;};
import { tokenCipher, startOAuth, completeOAuth } from "../server/providers/mail/oauth.mjs";
import { syncMailbox } from "../server/providers/mail/inbox.mjs";
import { classifyEmail, ingestMessage, scheduleMailboxSync, INBOX_SYNC_INTERVAL } from "../server/services/inbox.mjs";
import { taskQueue } from "../server/queue.mjs";
import { canonicalJobKey, mergeJobListings, fetchJobs } from "../server/providers/jobs/index.mjs";
import { cosineSimilarity, factPreservingTailor } from "../server/services/ai.mjs";
import { businessSlot, afterBusinessDays } from "../server/services/outreach.mjs";
import { verifyWorkEmail, targetTitles } from "../server/providers/contacts/verification.mjs";
import { persistResume, hydrateResume } from "../server/services/resume-storage.mjs";
import { buildAnswers } from "../extension/autofill.mjs";
import { mimeMessage } from "../server/providers/mail/native.mjs";
import { initialState } from "../server/fixtures.mjs";
const response = v => new Response(JSON.stringify(v)),
  config = {
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64")
  };
test('connected inbox polling is durable, bounded, and stops after disconnect without push credentials',async t=>{
  const store=openStore(':memory:');t.after(()=>store.close());const queue=taskQueue(store),clock=Date.now();
  store.db.prepare("INSERT INTO mail_accounts(id,provider,email,secret) VALUES('mailbox','google','owner@company.com','encrypted-test-only')").run();
  assert.equal(await store.run(()=>scheduleMailboxSync(store,queue,clock)),1);
  assert.equal(await store.run(()=>scheduleMailboxSync(store,queue,clock+60000)),0);
  assert.equal((await queue.list()).filter(t=>t.kind==='inbox.sync').length,1);
  assert.equal(store.db.prepare("SELECT next_run FROM autopilot_schedule WHERE id='mailbox:mailbox'").get().next_run,clock+INBOX_SYNC_INTERVAL);
  assert.equal(await store.run(()=>scheduleMailboxSync(store,queue,clock+INBOX_SYNC_INTERVAL)),1);
  store.db.prepare("DELETE FROM mail_accounts WHERE id='mailbox'").run();
  assert.equal(await store.run(()=>scheduleMailboxSync(store,queue,clock+2*INBOX_SYNC_INTERVAL)),0);
});
test("deduplication preserves application-linked job identity and independent source freshness", () => {
  const old = {
    id: "saved-id",
    company: "Acme",
    title: "Frontend Engineer",
    location: "Remote",
    description: "React",
    url: "https://a.com/1",
    source: "Remotive",
    tags: [],
    isDemo: false
  };
  const other = {
    ...old,
    id: "greenhouse-id",
    company: "ACME",
    description: "React and SQL",
    source: "Greenhouse",
    url: "https://b.com/1"
  };
  assert.equal(canonicalJobKey(old), canonicalJobKey(other));
  let merged = mergeJobListings([old], [other], "Greenhouse", "acme");
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "saved-id");
  assert.equal(merged[0].sources.length, 2);
  merged = mergeJobListings(merged, [], "Remotive");
  assert.equal(merged[0].archived, false);
  merged = mergeJobListings(merged, [], "Greenhouse", "acme");
  assert.equal(merged[0].archived, true);
});
test("Ashby and Adzuna use validated official endpoints and preserve provenance", async () => {
  const jobs = await fetchJobs("Ashby", "acme", async url => {
    assert.match(url, /api.ashbyhq.com\/posting-api\/job-board\/acme/);
    return response({
      jobs: [{
        id: "1",
        title: "Engineer",
        location: "Remote",
        isRemote: true,
        applyUrl: "https://jobs.ashbyhq.com/acme/1",
        descriptionPlain: "React",
        compensation: {
          compensationTierSummary: "100k"
        }
      }]
    });
  });
  assert.equal(jobs[0].salary, "100k");
  assert.equal(jobs[0].source, "Ashby");
  await assert.rejects(fetchJobs("Ashby", "../internal"), /slug/);
  await assert.rejects(fetchJobs("Adzuna"), /credentials/);
});
test("verification never upgrades a catch-all address and role targeting adapts to company size", async () => {
  const c = {
    HUNTER_API_KEY: "test"
  };
  assert.equal((await verifyWorkEmail("a@company.com", c, async () => response({
    data: {
      status: "valid",
      result: "deliverable",
      accept_all: false
    }
  }), async () => [{exchange:"mx.company.com"}])).emailStatus, "verified");
  assert.equal((await verifyWorkEmail("a@company.com", c, async () => response({
    data: {
      status: "valid",
      result: "deliverable",
      accept_all: true
    }
  }), async () => [{exchange:"mx.company.com"}])).emailStatus, "catch-all");
  assert.ok(targetTitles(25).includes("Founder"));
  assert.ok(targetTitles(250).includes("Technical Recruiter"));
});
test("token encryption detects tampering and OAuth uses single-use state plus PKCE", async t => {
  const store = openStore(":memory:");
  t.after(() => store.close());
  const options = {
      ...config,
      GOOGLE_CLIENT_ID: "client",
      GOOGLE_CLIENT_SECRET: "secret",
      PUBLIC_BASE_URL: "http://127.0.0.1:3000"
    },
    cipher = tokenCipher(options),
    sealed = cipher.seal({
      refresh_token: "private"
    });
  assert.ok(!sealed.includes("private"));
  assert.equal(cipher.open(sealed).refresh_token, "private");
  assert.throws(() => tokenCipher({
    ...config,
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64")
  }).open(sealed), /decrypted/);
  const url = new URL(await startOAuth("google", store, options));
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  let calls = 0;
  const result = await completeOAuth("google", "code", url.searchParams.get("state"), store, options, async u => {
    calls++;
    return u.includes("token") ? response({
      access_token: "access",
      refresh_token: "refresh",
      expires_in: 3600
    }) : response({
      emailAddress: "me@candidate.com"
    });
  });
  assert.equal(result.email, "me@candidate.com");
  assert.equal(calls, 2);
  assert.ok(!(await store.db.prepare("SELECT secret FROM mail_accounts").get()).secret.includes("refresh_token"));
  await assert.rejects(completeOAuth("google", "code", url.searchParams.get("state"), store, options), /expired/);
});
test("Gmail bootstrap captures history before listing so messages arriving during paging are not skipped", async t => {
  const store = openStore(":memory:");
  t.after(() => store.close());
  await store.db.prepare("INSERT INTO mail_accounts(id,provider,email,secret,metadata) VALUES(?,?,?,?,?)").run("a", "google", "me@candidate.com", tokenCipher(config).seal({
    access_token: "access",
    refresh_token: "refresh",
    expires_at: Date.now() + 3600000
  }), "{}");
  let profiles = 0;
  const calls = [];
  await syncMailbox("a", store, config, async url => {
    calls.push(url);
    if (url.endsWith("/profile")) return response({
      historyId: ++profiles === 1 ? "100" : "200"
    });
    if (url.includes("/messages?")) return response({
      messages: [{
        id: "m1"
      }]
    });
    return response({
      id: "m1",
      threadId: "t1",
      internalDate: String(Date.now()),
      labelIds: ["INBOX"],
      payload: {
        mimeType: "text/plain",
        headers: [{
          name: "From",
          value: "hr@company.com"
        }, {
          name: "Subject",
          value: "Application received"
        }],
        body: {
          data: Buffer.from("Thanks").toString("base64url")
        }
      }
    });
  });
  assert.match(calls[0], /profile/);
  const metadata = JSON.parse((await store.db.prepare("SELECT metadata FROM mail_accounts").get()).metadata);
  assert.equal(metadata.historyId, "100");
  assert.equal((await store.db.prepare("SELECT count(*) AS n FROM inbox_messages").get()).n, 1);
});
test("email classification extracts assessment deadlines but holds ambiguous and regressive updates", async t => {
  const store = openStore(":memory:");
  t.after(() => store.close());
  store.state.settings.inboxAutoUpdate = true;
  await store.save();
  const a = store.state.applications[0],
    j = store.state.jobs.find(j => j.id === a.jobId),
    email = {
      id: "m1",
      from: "team@forma.com",
      subject: `${j.title} at ${j.company}: online assessment`,
      body: "Please finish CodeSignal. Deadline: 2026-10-21. https://codesignal.com/assessment/123",
      receivedAt: new Date().toISOString(),
      threadId: "t1"
    };
  const result = classifyEmail(email, store.state);
  assert.equal(result.applicationId, a.id);
  assert.equal(result.proposedStage, "Assessment");
  assert.equal(result.deadline, "2026-10-21");
  await ingestMessage(email, store);
  assert.equal(store.state.applications[0].stage, "Assessment");
  assert.equal(store.state.inbox[0].status, "Auto-applied");
  await ingestMessage(email, store);
  assert.equal(store.state.inbox.length, 1);
  store.state.applications[0].stage = "Offer";
  await store.save();
  await ingestMessage({
    ...email,
    id: "m2",
    subject: `${j.title} at ${j.company}: rejected`,
    body: "Unfortunately we are not moving forward."
  }, store);
  assert.equal(store.state.applications[0].stage, "Offer");
  assert.equal(store.state.inbox[0].status, "Needs review");
});
test("a real reply stops outreach even when it contains no application-status keywords", async t => {
  const store = openStore(":memory:");
  t.after(() => store.close());
  const contact = store.state.contacts[0];
  store.state.campaigns.push({
    id: "c",
    name: "Intro",
    status: "Accepted",
    deliveries: [{
      contactId: contact.id,
      status: "accepted",
      threadId: "thread"
    }]
  });
  await store.save();
  await ingestMessage({
    id: "reply",
    from: `Jamie <${contact.email}>`,
    subject: "Re: Hello",
    body: "Happy to talk tomorrow.",
    threadId: "thread",
    receivedAt: new Date().toISOString()
  }, store);
  assert.ok(store.state.campaigns[0].deliveries[0].repliedAt);
  assert.ok(store.state.campaigns[0].deliveries[0].followupStopped);
});
test("business-hour scheduling handles weekends and valid IANA time zones", () => {
  assert.equal(new Date(businessSlot(Date.parse("2026-10-17T12:00:00Z"), "UTC")).toISOString(), "2026-10-19T09:00:00.000Z");
  assert.equal(new Date(businessSlot(Date.parse("2026-10-19T03:00:00Z"), "Asia/Kolkata")).toISOString(), "2026-10-19T03:30:00.000Z");
  assert.equal(new Date(afterBusinessDays(Date.parse("2026-10-16T09:00:00Z"), 4)).toISOString(), "2026-10-22T09:00:00.000Z");
  assert.throws(() => businessSlot(Date.now(), "Not/AZone"), /time zone/);
});
test("semantic scoring rejects mismatched vectors and tailoring never adds unsupported bullets", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.throws(() => cosineSimilarity([1], [1, 2]), /dimensions/);
  const resume = {
      name: "r.txt",
      base64: "YWJj",
      text: "Casey Quinn\n- Built React UI\n- Worked with SQL"
    },
    j = {
      id: "j",
      company: "Company",
      title: "React Engineer",
      description: "React UI TypeScript"
    },
    version = factPreservingTailor(resume, j, {
      name: "Casey",
      email: "c@company.com",
      skills: ["React", "SQL"]
    });
  assert.equal(version.bullets[0].text, "Built React UI");
  assert.ok(version.bullets.every(b => resume.text.includes(b.text)));
  assert.ok(!version.sourceText.includes("TypeScript"));
});
test("S3/R2 storage is private, integrity-checked, and does not require public bucket URLs", async t => {
  const store = openStore(":memory:");
  t.after(() => store.close());
  let bytes;
  const client = {
    async send(command) {
      if (command.constructor.name === "PutObjectCommand") {
        bytes = command.input.Body;
        assert.equal(command.input.ACL, undefined);
        return {};
      }
      return {
        Body: {
          async transformToByteArray() {
            return bytes;
          }
        }
      };
    }
  };
  const resume = {
    name: "r.txt",
    base64: Buffer.from("Private file").toString("base64")
  };
  const saved = await persistResume(resume, store, {
    S3_BUCKET: "private"
  }, client);
  assert.equal(saved.base64, undefined);
  assert.equal(saved.storage.kind, "s3");
  assert.equal((await hydrateResume(saved, store, {
    S3_BUCKET: "private"
  }, client)).base64, resume.base64);
  bytes = Buffer.from("Tampered");
  await assert.rejects(hydrateResume(saved, store, {
    S3_BUCKET: "private"
  }, client), /integrity/);
});
test("browser answer mapping uses only approved fields and native MIME retains reply headers", () => {
  const values = buildAnswers({
    name: "Casey Quinn",
    email: "c@candidate.com",
    authorization: "Maybe"
  }, [{
    question: "Years of React experience",
    answer: "2"
  }]);
  assert.equal(values.firstname, "Casey");
  assert.equal(values.yearsofreactexperience, "2");
  assert.equal(values.workauthorization, undefined);
  const mime = mimeMessage({
    to: "hr@company.com",
    subject: "Hello",
    body: "Follow-up",
    inReplyTo: "<original@company.com>"
  }, "c@candidate.com", null);
  const raw = Buffer.from(mime.raw, "base64url").toString();
  assert.match(raw, /In-Reply-To: <original@company.com>/);
  assert.match(raw, /References: <original@company.com>/);
  assert.throws(() => mimeMessage({
    to: "hr@company.com",
    subject: "Hello\r\nBcc: other",
    body: "x"
  }, "c@candidate.com", null), /newlines/);
});

test('MX precheck saves verifier credits on dead/null-MX domains and holds temporary DNS failures',async()=>{
  let credits=0;const fetcher=async url=>{if(String(url).includes('dns.google'))return response({Status:2});credits++;throw Error('Must not call paid verifier');};
  const missing=async()=>{throw Object.assign(Error('NXDOMAIN'),{code:'ENOTFOUND'});};
  const temporary=async()=>{throw Object.assign(Error('temporary'),{code:'ETIMEOUT'});};
  assert.equal((await verifyWorkEmail('hr@company.com',{HUNTER_API_KEY:'test'},fetcher,missing)).emailStatus,'invalid');
  assert.equal((await verifyWorkEmail('hr@company.com',{HUNTER_API_KEY:'test'},fetcher,async()=>[{priority:0,exchange:'.'}])).emailStatus,'invalid');
  assert.equal((await verifyWorkEmail('hr@company.com',{HUNTER_API_KEY:'test'},fetcher,temporary)).emailStatus,'unverified');
  assert.equal(credits,0);
});
test('structured AI and embeddings cache exact content/provider/model and invalidate changed inputs',async t=>{
  const {structuredAI,embedTexts}=await import('../server/services/ai.mjs');
  const {z}=await import('zod');
  const store=openStore(':memory:');t.after(()=>store.close());
  const schema=z.object({value:z.string()}).strict();
  const options={LLM_API_KEY:'test',LLM_MODEL:'model-a',EMBEDDING_MODEL:'embedding-a'};
  let calls=0;
  const fetcher=async(url,request)=>{
    calls++;const body=JSON.parse(request.body);
    return response(url.endsWith('/embeddings') ? {data:body.input.map((_,i)=>({index:i,embedding:[1,0.5,0.1]}))} : {choices:[{message:{content:'{"value":"source fact"}'}}]});
  };
  await structuredAI(schema,'Extract',{resume_hash:'one',job_id:'a'},options,fetcher,store);
  await structuredAI(schema,'Extract',{resume_hash:'one',job_id:'a'},options,fetcher,store);
  assert.equal(calls,1);
  await structuredAI(schema,'Extract',{resume_hash:'two',job_id:'a'},options,fetcher,store);assert.equal(calls,2);
  await structuredAI(schema,'Extract',{resume_hash:'two',job_id:'a'},{...options,LLM_MODEL:'model-b'},fetcher,store);assert.equal(calls,3);
  await embedTexts(['resume text','job text'],options,fetcher,store);assert.equal(calls,4);
  await embedTexts(['resume text','job text'],options,fetcher,store);assert.equal(calls,4);
  await embedTexts(['resume text','new job text'],options,fetcher,store);assert.equal(calls,5);
});

test('compatible model APIs use Google endpoints for validated resume extraction and embeddings, with a longer AI deadline',async t=>{
  const {extractStructuredResume,embedTexts}=await import('../server/services/ai.mjs');
  const {setupReadiness}=await import('../server/discovery-routes.mjs');
  const store=openStore(':memory:');t.after(()=>store.close());
  const config={LLM_BASE_URL:'https://generativelanguage.googleapis.com/v1beta/openai/',LLM_MODEL:'gemini-3.5-flash-lite',LLM_API_KEY:'test-gemini-key',EMBEDDING_MODEL:'gemini-embedding-001'};
  const timeouts=[];t.mock.method(AbortSignal,'timeout',ms=>{timeouts.push(ms);return new AbortController().signal;});
  const extracted={skills:['React','SQL'],yearsOfExperience:null,education:[],workHistory:[],projects:[],linkedin:null,github:null,portfolio:null,noticePeriod:null,expectedSalary:null};
  let calls=0;
  const fetcher=async(url,request)=>{
    calls++;assert.equal(new URL(url).hostname,'generativelanguage.googleapis.com');assert.equal(request.headers.Authorization,'Bearer test-gemini-key');
    const body=JSON.parse(request.body);
    if(url.endsWith('/embeddings')) {
      assert.equal(body.model,'gemini-embedding-001');assert.deepEqual(body.input,['React resume','React job']);
      return response({data:[{index:1,embedding:[0,1,0]},{index:0,embedding:[1,0,0]}]});
    }
    assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');assert.equal(body.model,'gemini-3.5-flash-lite');
    assert.equal(body.response_format.json_schema.strict,true);assert.ok(body.response_format.json_schema.schema.properties.yearsOfExperience);
    assert.equal(body.response_format.json_schema.schema.$schema,undefined);
    return response({choices:[{message:{content:JSON.stringify(extracted)}}]});
  };
  assert.deepEqual(await extractStructuredResume({text:'Built React and SQL applications.'},config,fetcher,store),extracted);
  await extractStructuredResume({text:'Built React and SQL applications.'},config,fetcher,store);assert.equal(calls,1);
  assert.deepEqual(await embedTexts(['React resume','React job'],config,fetcher,store),[[1,0,0],[0,1,0]]);
  assert.deepEqual(timeouts,[60000,60000]);assert.equal(setupReadiness(store,config).geminiConfigured,true);
  assert.equal(setupReadiness(store,{...config,LLM_API_KEY:''}).geminiConfigured,false);
  await assert.rejects(extractStructuredResume({text:'A changed resume'},config,async()=>response({choices:[{message:{content:'{"skills":"not-an-array"}'}}]}),store),/schema validation/);
  assert.equal(store.db.prepare('SELECT count(*) AS count FROM ai_cache').get().count,1,'Invalid model output is never cached');
});

test('native Gemini preserves nullable resume fields, ignores thought parts, and bounds embedding batches',async t=>{
  const {extractStructuredResume,embedTexts,structuredAI}=await import('../server/services/ai.mjs');
  const {z}=await import('zod');const store=openStore(':memory:');t.after(()=>store.close());
  const config={LLM_PROVIDER:'gemini',LLM_BASE_URL:'https://generativelanguage.googleapis.com/v1beta',LLM_MODEL:'gemini-3.5-flash-lite',LLM_API_KEY:'test-native-key',EMBEDDING_MODEL:'gemini-embedding-001'};
  const extracted={skills:['React'],yearsOfExperience:null,education:[],workHistory:[],projects:[],linkedin:null,github:null,portfolio:null,noticePeriod:null,expectedSalary:null};
  let generations=0;const batches=[];
  const fetcher=async(url,request)=>{
    assert.equal(request.headers['X-goog-api-key'],'test-native-key');assert.equal(request.headers.Authorization,undefined);assert.ok(!String(url).includes('test-native-key'));
    const body=JSON.parse(request.body);
    if(url.endsWith(':batchEmbedContents')) {
      assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents');
      batches.push(body.requests.length);assert.ok(body.requests.every(r=>r.model==='models/gemini-embedding-001' && r.taskType==='SEMANTIC_SIMILARITY'));
      return response({embeddings:body.requests.map(()=>({values:[1,.2,0]}))});
    }
    generations++;assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    assert.equal(body.generationConfig.responseMimeType,'application/json');
    const schema=body.generationConfig.responseJsonSchema;
    assert.ok(schema.properties.yearsOfExperience);assert.equal(schema.properties.skills.maxItems,undefined);
    assert.equal(schema.properties.education.items.properties.year.type[1],'null');
    assert.match(body.systemInstruction.parts[0].text,/untrusted data/);assert.match(body.contents[0].parts[0].text,/React/);
    return response({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'Not JSON: private reasoning'},{text:JSON.stringify(extracted)}]}}]});
  };
  assert.deepEqual(await extractStructuredResume({text:'Built a React app.'},config,fetcher,store),extracted);
  await extractStructuredResume({text:'Built a React app.'},config,fetcher,store);assert.equal(generations,1);
  const inputs=Array.from({length:105},(_,i)=>`job ${i}`);
  assert.equal((await embedTexts(inputs,config,fetcher,store)).length,105);assert.deepEqual(batches,[100,5]);
  await embedTexts(inputs,config,fetcher,store);assert.deepEqual(batches,[100,5]);
  await assert.rejects(structuredAI(z.object({value:z.string()}),'Extract',{},config,async()=>response({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'{"value":"partial"}'}]}}]}),store),/incomplete response/);
  await assert.rejects(structuredAI(z.object({value:z.string()}),'Extract',{},config,async()=>response({promptFeedback:{blockReason:'SAFETY'}}),store),/usable response/);
  const tooManySkills={...extracted,skills:Array.from({length:81},(_,i)=>`skill ${i}`)};
  await assert.rejects(extractStructuredResume({text:'Another React resume.'},config,async()=>response({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(tooManySkills)}]}}]}),store),/schema validation/);
  assert.equal(store.db.prepare('SELECT count(*) AS count FROM ai_cache').get().count,1,'Gemini output must pass the complete local schema before caching');
});

test('an explicit unsubscribe reply suppresses the contact across campaigns',async t=>{
  const store=openStore(':memory:');t.after(()=>store.close());
  const contact=store.state.contacts[0];contact.email='hr@company.com';contact.suppressed=false;store.save();
  await ingestMessage({id:'unsubscribe-reply',from:'HR <hr@company.com>',subject:'Re: Hello',body:'Please unsubscribe me.',receivedAt:new Date().toISOString()},store);
  assert.equal(store.state.contacts[0].suppressed,true);
});

test('spintax expands before merge values, remains deterministic per recipient and tightening preserves resume links under ninety words',async()=>{
  const {mergeMail,expandSpintax,safeSpintax,tightenMail}=await import('../shared/mail-merge.mjs');
  const template=safeSpintax('Hi {{firstName}},\nI would welcome a short conversation. {{company}}'),contact={name:'Riley Chen',email:'riley@company.com',company:'{A|B} Holdings'};
  assert.match(template,/\{Hi\|Hello\|Hey\}/);const first=mergeMail(template,contact,{});assert.equal(first,mergeMail(template,contact,{}));assert.match(first,/^(Hi|Hello|Hey) Riley/);assert.ok(first.includes('{A|B} Holdings'),'Contact data is not executable spintax');
  const greetings=new Set(Array.from({length:30},(_,i)=>mergeMail('{Hi|Hello|Hey} {{firstName}}',{name:'Riley',email:`p${i}@company.com`},{}).split(' ')[0]));assert.equal(greetings.size,3);assert.equal(expandSpintax('{{firstName}}'), '{{firstName}}');
  const long='Hi Riley,\nMy resume: https://candidate.example/resume\n'+Array(160).fill('evidence').join(' '),tight=tightenMail(long);assert.ok(tight.split(/\s+/).length<90);assert.equal(tight.match(/https:\/\/candidate.example\/resume/g).length,1);assert.ok(tightenMail('Short note.').includes('Short note.'));
});
test('deliverability content checks flag exact word/link/phrase conditions without promising inbox placement',async()=>{
  const {scoreDeliverability}=await import('../server/services/deliverability.mjs');
  const safe=scoreDeliverability({subject:'Analyst opening',body:'{Hi|Hello} {{firstName}}, may I ask about the analyst opening?'});assert.equal(safe.score,100);assert.match(safe.note,/does not predict inbox placement/);
  const risky=scoreDeliverability({subject:'URGENT guarantee',body:Array(126).fill('word').join(' ')+' Free click here https://one.test https://two.test https://three.test'});assert.equal(risky.links,3);assert.ok(risky.score<50);assert.equal(risky.warnings.length,3);assert.equal(scoreDeliverability({}).score,50);
});
test('reply classifier prioritizes interviews and OOO, ignores quoted addresses, and records referrals without self-certifying mailboxes',async t=>{
  const {classifyReply}=await import('../server/services/inbox.mjs');
  assert.equal(classifyReply({subject:'Re: Analyst role',body:'Could you share your availability for a call?'}).category,'interview');
  assert.equal(classifyReply({subject:'Re: Analyst role',body:'Happy to refer you to our team.'}).category,'positive');
  assert.equal(classifyReply({subject:'Re: Interview',body:'Unfortunately we are not moving forward.'}).category,'other');
  const store=openEmptyStore(':memory:');t.after(()=>store.close());store.db.prepare("INSERT INTO companies(domain,name,body) VALUES('company.com','Company','{}')").run();store.state.contacts=[{id:'recruiter',name:'Riley Chen',email:'riley@company.com',company:'Company',companyDomain:'company.com',isDemo:false}];
  const message={id:'ooo',from:'Riley <riley@company.com>',subject:'Automatic reply: interview',body:'I am out of office until 28 October 2026. Please contact colleague@company.com or external@another.com.\nOn Monday someone wrote:\nquoted@company.com',receivedAt:'2026-10-24T10:00:00Z'};
  const result=await ingestMessage(message,store);assert.equal(result.item.category,'ooo');assert.equal(result.item.proposedStage,null);assert.equal(result.item.outOfOffice.returnDate,'2026-10-28');assert.equal(result.item.referralContactIds.length,2);
  for(const email of ['colleague@company.com','external@another.com']){const c=store.state.contacts.find(c=>c.email===email);assert.equal(c.emailStatus,'unverified');assert.equal(c.emailObserved,true);assert.match(c.verification.reference,/mail:ooo/);}
  assert.equal(store.state.contacts.find(c=>c.email==='external@another.com').requiresDomainReview,true);assert.ok(!store.state.contacts.some(c=>c.email==='quoted@company.com'));await ingestMessage(message,store);assert.equal(store.state.inbox.length,1);assert.equal(store.state.contacts.length,3);
});
test('compensation uses matching advertised annual pay only, exposes evidence, never guesses bonus, and validates targets',async t=>{
  const {annualSalary,negotiationKit}=await import('../server/services/career.mjs').then(async m=>({...m,...await import('../server/services/negotiation.mjs')}));
  assert.deepEqual(annualSalary({salary:'INR 12–18 LPA'},'INR'),{low:1200000,high:1800000,midpoint:1500000,currency:'INR',component:'Advertised pay · base/bonus not separated'});assert.equal(annualSalary({salary:'USD 100k–120k per year'},'INR'),null);assert.equal(annualSalary({salary:'INR 500 per hour'},'INR'),null);assert.equal(annualSalary({salary:'INR 50,000 per month'},'INR').midpoint,600000);
  const store=openEmptyStore(':memory:');t.after(()=>store.close());store.state.jobs=Array.from({length:5},(_,i)=>({id:`salary-${i}`,company:`Company ${i}`,title:'Financial Analyst',location:'Mumbai',salary:`INR ${10+i*2}–${12+i*2} LPA`,url:`https://company.example/jobs/${i}`,isDemo:false,publishedAt:new Date().toISOString()}));store.state.profile.expectedSalary='INR 1800000 annually';
  const kit=await negotiationKit({role:'Financial Analyst',location:'Mumbai',targetSalary:1800000},store);assert.equal(kit.sampleSize,5);assert.deepEqual(kit.percentiles,{25:1300000,50:1500000,75:1700000,90:1820000});assert.equal(kit.bonusPercentiles,null);assert.match(kit.email,/INR 1,800,000 per year/);assert.equal(kit.sources.length,5);assert.match(kit.method,/not a population salary survey/);
  store.state.jobs.pop();const thin=await negotiationKit({role:'Financial Analyst',location:'Mumbai'},store);assert.equal(thin.percentiles,null);assert.match(thin.email,/INR 1800000 annually/);assert.ok(!thin.note.includes('estimated at'));
  for(const targetSalary of ['invalid',0,-1,'1e100'])await assert.rejects(negotiationKit({role:'Financial Analyst',location:'Mumbai',targetSalary},store),/valid annual/);
});
