import { spawn } from "node:child_process";
const children = [
  spawn(
    process.execPath,
    ["--env-file-if-exists=.env", "--watch", "server/index.mjs"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        WEB_BASE_URL: process.env.WEB_BASE_URL || "http://127.0.0.1:5173",
      },
    },
  ),
  spawn(process.execPath, ["--env-file-if-exists=.env", "server/worker.mjs"], {
    stdio: "inherit",
    env: {
      ...process.env,
      WEB_BASE_URL: process.env.WEB_BASE_URL || "http://127.0.0.1:5173",
    },
  }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
    stdio: "inherit",
    env: {
      ...process.env,
      WEB_BASE_URL: process.env.WEB_BASE_URL || "http://127.0.0.1:5173",
    },
  }),
];
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => close());
for (const child of children) {
  child.on("error", (error) => {
    console.error(error.message);
    close(1);
  });
  child.on("exit", (code) => {
    if (!closing) close(code || 0);
  });
}
