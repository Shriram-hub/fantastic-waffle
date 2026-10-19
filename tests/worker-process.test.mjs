import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { openStore } from "../server/store.mjs";
import { taskQueue } from "../server/queue.mjs";
import { hash } from "../server/domain.mjs";
import { hydrateResume } from "../server/services/resume-storage.mjs";
test("a real separate worker process claims persisted work and stores private resume bytes outside SQLite", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-process-")),
    store = openStore(dir),
    queue = taskQueue(store),
    base64 = Buffer.from(
      "Casey Quinn\n- Built React applications\nSQL",
    ).toString("base64");
  store.state.resume = {
    name: "resume.txt",
    base64,
    size: 40,
    text: "",
    uploadedAt: new Date().toISOString(),
  };
  store.save();
  const task = queue.enqueue("resume.parse", { resumeHash: hash(base64) });
  const child = spawn(process.execPath, ["server/worker.mjs"], {
    cwd: new URL("../", import.meta.url),
    env: {
      ...process.env,
      DATA_DIR: dir,
      REDIS_URL: "",
      S3_BUCKET: "",
      LLM_API_KEY: "",
      ENABLE_LIVE_SEND: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => {
    output += d;
  });
  child.stderr.on("data", (d) => {
    output += d;
  });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  for (let i = 0; i < 120 && queue.get(task.id).status !== "completed"; i++) {
    if (child.exitCode !== null) break;
    await pause(50);
  }
  assert.equal(queue.get(task.id).status, "completed", output);
  const resume = store.refresh().resume;
  assert.equal(resume.storage.kind, "local");
  assert.equal(resume.base64, undefined);
  assert.equal((await hydrateResume(resume, store)).base64, base64);
  assert.match(resume.text, /React/);
  assert.match(output, /worker started/);
});

test('embedded worker starts with the hosted API and shuts down with its parent',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'orbit-embedded-'));
  const child=spawn(process.execPath,['server/index.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:dir,DATABASE_URL:'',RUN_EMBEDDED_WORKER:'true',REDIS_URL:'',ENABLE_LIVE_SEND:'false'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
  t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}rmSync(dir,{recursive:true,force:true});});
  for(let i=0;i<100 && !/http:\/\/127\.0\.0\.1:\d+/.test(output);i++)await pause(50);
  const origin=output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert.ok(origin,output);
  const response=await fetch(origin+'/api/resume',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'hosted.txt',base64:Buffer.from('Hosted worker test\nReact and SQL').toString('base64')})});
  assert.equal(response.status,202);const task=(await response.json()).task;
  let current;
  for(let i=0;i<100;i++){const data=await (await fetch(origin+'/api/tasks')).json();current=data.tasks.find(value=>value.id===task.id);if(current?.status==='completed')break;await pause(50);}
  assert.equal(current.status,'completed',output);
  const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');assert.equal(await exited,0);assert.match(output,/worker started/);
});
