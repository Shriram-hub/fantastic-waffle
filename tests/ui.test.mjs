import test from "node:test";
import assert from "node:assert/strict";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { writeFile, mkdir, rm } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { initialState } from "../server/fixtures.mjs";
import { AUTOPILOT_DEFAULTS } from "../server/services/autopilot-policy.mjs";
import { scoreJob } from "../server/domain.mjs";
test("React views render populated/empty states and escape untrusted profile and job text", async (t) => {
  const output = await build({
    configFile: false,
    plugins: [react()],
    logLevel: "silent",
    build: {
      ssr: new URL("../web/src/App.jsx", import.meta.url).pathname,
      write: false,
      minify: false,
    },
  });
  await mkdir(".test-build", { recursive: true });
  const path = new URL("../.test-build/ui.mjs", import.meta.url);
  await writeFile(path, output.output[0].code);
  t.after(() => rm(".test-build", { recursive: true, force: true }));
  const views = await import(`${path.href}?t=${Date.now()}`);
  for (const demo of [true, false]) {
    const data = initialState(demo);
    data.profile.name = "<img src=x onerror=alert(1)>";
    if (data.jobs.length) data.jobs[0].title = "<script>alert(1)</script>";
    data.jobs = data.jobs.map((j) => ({
      ...j,
      match: scoreJob(j, data.profile),
    }));
    const app = {
      data,
      accounts: [],
      tasks: { tasks: [], applications: [] },
      vault: { versions: [], links: [] },
      integrations: {},
      autopilot: {policy:AUTOPILOT_DEFAULTS,reviewCount:0,activity:[{id:'activity-1',at:Date.now(),kind:'discovery',message:'<script>alert(1)</script>'}],blockers:{discovery:[],contacts:[],sending:[]},runs:[],lookupsToday:0},
      perform() {},
      notify() {},
      setModal() {},
      go() {},
    };
    for (const name of [
      "Overview",
      "Jobs",
      "Applications",
      "Profile",
      "Contacts",
      "Outreach",
      "Inbox",
      "Automation",
      "Connections",
    ]) {
      const html = renderToStaticMarkup(
        React.createElement(
          views.WorkspaceContext.Provider,
          { value: app },
          React.createElement(views[name]),
        ),
      );
      assert.ok(html.length > 100);
      if(name === "Automation") {assert.match(html,/Autopilot Mode/);assert.match(html,/Enable Autopilot/);assert.match(html,/Approve|review queue/);}
      assert.ok(!html.includes("<script>alert(1)</script>"));
      assert.ok(!html.includes("<img src=x"));
    }
  }
});
