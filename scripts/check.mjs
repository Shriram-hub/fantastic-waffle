import { readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
for (const root of ["server", "scripts", "extension"])
  for (const entry of readdirSync(root, { recursive: true }))
    if (/\.(mjs|js)$/.test(entry))
      execFileSync(process.execPath, ["--check", join(root, entry)], {
        stdio: "inherit",
      });
console.log(
  "Server, worker, scripts, and extension syntax passed. Use npm run build to check JSX.",
);
