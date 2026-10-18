import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { initialState } from "../server/fixtures.mjs";
import { scoreJob } from "../server/domain.mjs";

// Browser-free rendering checks. These are not a substitute for a real browser QA pass.
test("every page renders populated and empty states, and user-controlled text is escaped", async () => {
  const data = initialState(),
    nodes = { "#app": { innerHTML: "" }, "#modal": { addEventListener() {} } };
  data.profile.name = "<img src=x onerror=alert(1)>";
  data.contacts[0].name = "<script>alert(1)</script>";
  data.jobs = data.jobs.map((j) => ({
    ...j,
    match: scoreJob(j, data.profile),
  }));
  const document = { querySelector: (s) => nodes[s], addEventListener() {} };
  const context = vm.createContext({
    document,
    window: { addEventListener() {}, scrollTo() {} },
    location: { hash: "#overview" },
    console,
    setTimeout,
    Date,
    Set,
    URL,
    fetch: async (url) => ({
      ok: true,
      json: async () => (url === "/api/state" ? data : {}),
    }),
  });
  const script = await readFile(
    new URL("../public/app.js", import.meta.url),
    "utf8",
  );
  await vm.runInContext(script, context);
  assert.ok(nodes["#app"].innerHTML.includes("&lt;img"));
  assert.ok(!nodes["#app"].innerHTML.includes("<img src=x"));
  for (const route of [
    "overview",
    "jobs",
    "applications",
    "contacts",
    "outreach",
    "inbox",
    "profile",
    "connections",
  ]) {
    vm.runInContext(`state.route = '${route}'; render();`, context);
    assert.match(nodes["#app"].innerHTML, /<main id="main">/);
    assert.ok(!nodes["#app"].innerHTML.includes("<script>alert(1)"));
  }
  const clean = initialState(false);
  context.clean = clean;
  vm.runInContext("state.data = clean;", context);
  for (const route of [
    "overview",
    "jobs",
    "applications",
    "contacts",
    "outreach",
    "inbox",
    "profile",
    "connections",
  ]) {
    vm.runInContext(`state.route = '${route}'; render();`, context);
    assert.ok(nodes["#app"].innerHTML.includes("Orbit v0.1"));
  }
});
