import test from "node:test";
import assert from "node:assert/strict";
import { initialState } from "../server/fixtures.mjs";
import {
  scoreJob,
  parseCSV,
  normalizeContact,
  previewCampaign,
  campaignFingerprint,
  renderTemplate,
  suggestStage,
  safeUrl,
  sampleEmail,
} from "../server/domain.mjs";
import { parseResume } from "../server/resume.mjs";
import { deflateRawSync } from "node:zlib";

test("matching explains its score and does not invent a score for an empty profile", () => {
  const s = initialState();
  const j = s.jobs[1],
    m = scoreJob(j, s.profile);
  assert.equal(m.matched.length, 5);
  assert.ok(m.score >= 70 && m.score <= 100);
  assert.equal(m.reasons.length, 4);
  assert.equal(scoreJob(j, { skills: [], interests: [] }).score, null);
  assert.equal(
    scoreJob(j, {
      skills: ["Clinical analysis"],
      interests: ["Researcher"],
      workMode: "On-site",
      location: "Delhi",
    }).score,
    0,
  );
  assert.deepEqual(
    scoreJob(
      {
        ...j,
        description: "JavaScript",
        title: "Frontend developer",
        tags: [],
      },
      { skills: ["Java"], interests: [] },
    ).matched,
    [],
  );
});
test("CSV parser handles commas, quotes, CRLF, embedded lines, BOM, and malformed files", () => {
  const rows = parseCSV(
    '\uFEFFname,email,company,title,email_status\r\n"Lee, Jo",jo@firm.example,"A ""Great"" Company","Lead\nRecruiter",verified\r\n',
  );
  assert.equal(rows[0].name, "Lee, Jo");
  assert.equal(rows[0].company, 'A "Great" Company');
  assert.equal(rows[0].title, "Lead\nRecruiter");
  assert.throws(() => parseCSV("name\nJo"), /email column/);
  assert.throws(() => parseCSV('email\n"unfinished'), /unclosed/);
  assert.throws(
    () => parseCSV(`email\n${Array(501).fill("a@b.com").join("\n")}`),
    /500/,
  );
});
test("contacts are normalized without guessing an email or independent verification", () => {
  assert.equal(
    normalizeContact({ name: "A", email: " HELLO@FIRM.COM " }).email,
    "hello@firm.com",
  );
  assert.equal(normalizeContact({ name: "A" }).email, "");
  assert.equal(
    normalizeContact({ email: "a@firm.com", email_status: "yes" }).emailStatus,
    "unverified",
  );
  assert.throws(
    () => normalizeContact({ email: "bad\r\nBcc: victim@firm.com" }),
    /Invalid email/,
  );
  assert.ok(sampleEmail("recruiter@company.example"));
  assert.ok(sampleEmail("name@example.com"));
  assert.equal(sampleEmail("name@company.com"), false);
});
test("campaigns render personal messages, exclude suppression, and bind to changing inputs", () => {
  const s = initialState(),
    c = {
      name: "Test",
      subject: "Hi {{first_name}} at {{company}}",
      body: "I am {{my_name}}. Skills: {{skills}}.",
      contactIds: s.contacts.map((x) => x.id),
      attachResume: false,
    };
  s.contacts[0].suppressed = true;
  const preview = previewCampaign(c, s);
  assert.equal(preview.messages.length, 4);
  assert.equal(preview.excluded[0].reason, "Suppressed");
  assert.match(preview.messages[0].subject, /Priya/);
  assert.match(preview.messages[0].body, /unsubscribe/);
  const before = campaignFingerprint(c, s);
  s.profile.summary = "Changed";
  assert.notEqual(campaignFingerprint(c, s), before);
  assert.throws(
    () => renderTemplate("Hello {{made_up}}", s.contacts[1], s.profile),
    /Unknown template variable/,
  );
  assert.throws(
    () => previewCampaign({ ...c, attachResume: true }, s),
    /Upload a résumé/,
  );
  assert.throws(
    () => previewCampaign({ ...c, subject: "Subject\r\nBcc: injected" }, s),
    /one line/,
  );
});
test("email phrase rules remain suggestions and URLs reject active-content schemes", () => {
  assert.equal(
    suggestStage("Interview invitation", "Let us schedule a conversation"),
    "Interview",
  );
  assert.equal(
    suggestStage(
      "Application update",
      "Unfortunately we are not moving forward. We enjoyed the interview.",
    ),
    "Rejected",
  );
  assert.equal(
    suggestStage("Welcome", "We are pleased to offer you a role."),
    "Offer",
  );
  assert.equal(suggestStage("Newsletter", "Weekly news"), null);
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(safeUrl("https://user:secret@company.com"), "");
  assert.equal(safeUrl("https://company.com/job"), "https://company.com/job");
});
test("résumé TXT parsing detects suggestions without overwriting profile and validates file signatures", () => {
  const result = parseResume({
    name: "candidate.txt",
    base64: Buffer.from(
      "A Candidate\na@candidate.com\nReact, SQL, Python and Node.js",
    ).toString("base64"),
  });
  assert.equal(result.suggestions.email, "a@candidate.com");
  assert.deepEqual(result.suggestions.skills, [
    "React",
    "Node.js",
    "Python",
    "SQL",
  ]);
  assert.ok(result.resume.text.includes("A Candidate"));
  assert.throws(
    () =>
      parseResume({
        name: "malicious.pdf",
        base64: Buffer.from("not pdf").toString("base64"),
      }),
    /signature/,
  );
  assert.throws(
    () => parseResume({ name: "macro.docm", base64: "YWJj" }),
    /PDF, DOCX, or TXT/,
  );
  assert.throws(
    () => parseResume({ name: "empty.txt", base64: "" }),
    /non-empty/,
  );
});
test("DOCX text extraction reads only document.xml and refuses decompression bombs", () => {
  const docx = (declaredSize = 80) => {
    const name = Buffer.from("word/document.xml"),
      xml = Buffer.from(
        "<w:document><w:p><w:t>Python &amp; SQL</w:t></w:p></w:document>",
      ),
      compressed = deflateRawSync(xml);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(xml.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(declaredSize, 24);
    central.writeUInt16LE(name.length, 28);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(local.length + name.length + compressed.length, 16);
    return Buffer.concat([
      local,
      name,
      compressed,
      central,
      name,
      end,
    ]).toString("base64");
  };
  assert.equal(
    parseResume({ name: "profile.docx", base64: docx() }).resume.text,
    "Python & SQL",
  );
  assert.throws(
    () => parseResume({ name: "bomb.docx", base64: docx(3_000_000) }),
    /too large/,
  );
});
