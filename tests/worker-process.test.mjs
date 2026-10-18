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
