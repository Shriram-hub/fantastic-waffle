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
  const signin=renderToStaticMarkup(React.createElement(views.SignIn,{session:{googleConfigured:true,googleLinked:false,passwordEnabled:true},onSignedIn(){}}));
  assert.match(signin,/Veloce/);assert.match(signin,/Candidate Pipeline &amp; Outbound Desk/);assert.ok(!signin.includes('Prototype'));assert.match(signin,/Continue with Google/);assert.match(signin,/Workspace password/);assert.match(signin,/first visit|First visit/);
  const recovery=renderToStaticMarkup(React.createElement(views.WorkspaceError,{message:'Please retry',reference:'safe-id',onRetry(){}}));assert.match(recovery,/Try again/);assert.match(recovery,/safe-id/);
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
      setup: {jsearchConfigured:false,serpapiConfigured:false},
      search: {preferences:{roles:[],location:'',country:'',workMode:'Any',experience:'Any',enabled:true,sources:{}},plan:{roles:[],personalized:false},run:null,sources:[],indexed:data.jobs.length,matches:null},
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
      "TailoredDocuments",
      "CommandPalette",
      'CareerWorkspace',
    ]) {
      const html = renderToStaticMarkup(
        React.createElement(
          views.WorkspaceContext.Provider,
          { value: app },
          React.createElement(views[name]),
        ),
      );
      assert.ok(html.length > 100);assert.ok(!/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(html),`${name} must render without emoji`);
      if(name==='Jobs') {assert.match(html,/Discover your next role/);assert.match(html,/Save &amp; find jobs/);assert.match(html,/Choose discovery sources/);assert.match(html,/Recently posted/);assert.match(html,/LinkedIn discovery window/);}
      if(name==='Overview'){assert.match(html,/Your opportunity funnel/);assert.match(html,/Today’s action queue/);assert.match(html,/Prepare outbound for 5 roles/);}
      if(name==='Applications'){assert.match(html,/Kanban Board/);assert.match(html,/Compact Table/);assert.match(html,/Outreach Sent/);assert.match(html,/OA \/ Assessment/);assert.match(html,/Archived/);}
      if(name==='CommandPalette'){assert.match(html,/role="combobox"/);assert.match(html,/Run Job Discovery Now/);assert.match(html,/Test Mailbox Connection/);}
      if(name==='Connections') assert.match(html,/Free job discovery/);
      if(name==='Contacts'){assert.match(html,/Find company contacts/);assert.match(html,/Use email search/);assert.match(html,/Public-only discovery/);assert.match(html,/Target persona/);assert.match(html,/Functional Hiring Managers/);}
      if(name==='CareerWorkspace'){assert.match(html,/Interview prep/);assert.match(html,/STAR stories/);assert.match(html,/Search analytics/);}
      if(name === "Automation") {assert.match(html,/Autopilot Mode/);assert.match(html,/Enable Autopilot/);assert.match(html,/Approve|review queue/);assert.match(html,/Add Any Company Career URL/);}
      assert.ok(!html.includes("<script>alert(1)</script>"));
      assert.ok(!html.includes("<img src=x"));
    }
    const career={tasks:[{id:'task',title:'Interview planning',kind:'Interview',dueAt:'2026-11-01T05:00:00Z',done:false,notes:'<script>alert(1)</script>'}],stories:[],prep:[],aiConfigured:true};
    for(const name of ['CareerPlanner','CareerPrep','StoryBank']){
      const html=renderToStaticMarkup(React.createElement(views.WorkspaceContext.Provider,{value:app},React.createElement(views[name],{workspace:career,jobs:data.jobs,stories:career.stories})));
      assert.ok(html.length>200);assert.ok(!html.includes('<script>alert(1)</script>'));
    }
  }
});


test('Command Palette searches workspace entities and executes concrete commands',async()=>{
  const {commandResults,executeCommand,commandDefinitions}=await import('../web/src/shared/commands.mjs');
  const data={jobs:[{id:'job',title:'Financial Analyst',company:'Acme'}],contacts:[{id:'person',name:'Acme recruiter',company:'Acme',email:'hr@acme.com'}],applications:[{id:'application',jobId:'job',stage:'Applied'}]};
  const results=commandResults('Acme',data);assert.ok(['job','contact','application'].every(type=>results.some(r=>r.type===type)));
  const calls=[],downloads=[],modals=[],routes=[];let toggles=0;const app={data,accounts:[{id:'mail'}],go:r=>routes.push(r),setModal:m=>modals.push(m),toggleTheme:()=>toggles++,perform:fn=>fn(),notify:()=>{}};
  const dependencies={api:async(path,body)=>{calls.push({path,body});return {message:'Queued'};},download:url=>downloads.push(url)};
  for(const command of commandDefinitions)await executeCommand({...command,type:'command'},app,dependencies);
  assert.equal(toggles,1);assert.ok(routes.includes('profile'));assert.deepEqual(downloads,['/api/export/contacts']);assert.deepEqual(calls.map(c=>c.path),['/jobs/discover','/queue/flush','/mail/mail/test-inbox']);assert.ok(!calls.some(c=>c.path.includes('test-send')));
  for(const result of results.filter(r=>r.type!=='command' && r.type!=='route'))await executeCommand(result,app,dependencies);
  assert.deepEqual(modals.map(m=>m.type),['job','contact-detail','application']);
});
test('Kanban stage grouping preserves detailed states until an explicit valid move',async()=>{
  const {applicationColumn,applicationTransition}=await import('../web/src/features/tracker/kanban.mjs');
  assert.equal(applicationColumn({stage:'Ready'}),'Saved');assert.equal(applicationColumn({stage:'Interview scheduled'}),'Interview');assert.equal(applicationColumn({stage:'Rejected'}),'Archived');assert.equal(applicationTransition({stage:'Interview scheduled'},'Interview'),null);assert.deepEqual(applicationTransition({stage:'Applied'},'Assessment'),{stage:'Assessment'});assert.throws(()=>applicationTransition({stage:'Applied'},'Made up'),/valid/);
});
test('Live document keyword meter checks exact résumé terms without pretending to predict ATS outcomes',async()=>{
  const {keywordCoverage}=await import('../web/src/features/resume/document-keywords.mjs');
  const coverage=keywordCoverage({title:'Financial Analyst',description:'SQL Excel Python Python forecasting',tags:['SQL','Python']},{headline:'Financial Analyst',sections:[{heading:'Skills',lines:['SQL Excel forecasting']}],coverLetter:['Python']});
  assert.ok(coverage.present.includes('sql'));assert.ok(coverage.missing.includes('python'));assert.ok(!coverage.present.includes('python'));assert.ok(coverage.percent>0 && coverage.percent<100);
});


test('shipped interface, extension and server sources contain no decorative Unicode emoji',async()=>{
  const {readdir,readFile}=await import('node:fs/promises');
  for(const root of ['web/src','extension','server'])for(const name of await readdir(root,{recursive:true}))if(/\.(jsx|mjs|js|html|css)$/.test(name)){
    const source=await readFile(`${root}/${name}`,'utf8');
    assert.ok(!/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(source),`${root}/${name} contains a decorative emoji`);
  }
});
