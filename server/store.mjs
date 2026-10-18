import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { initialState } from "./fixtures.mjs";

export function openStore(directory) {
  let path = ":memory:";
  if (directory !== ":memory:") {
    const root = resolve(directory);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    path = resolve(root, "orbit.sqlite");
  }
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL);",
  );
  if (path !== ":memory:") chmodSync(path, 0o600);
  const row = db.prepare("SELECT data FROM workspace WHERE id = 1").get();
  let state = row ? JSON.parse(row.data) : initialState();
  const save = () =>
    db
      .prepare(
        "INSERT INTO workspace(id,data) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(JSON.stringify(state));
  // A crash after an outbound request must never cause an automatic resend.
  for (const campaign of state.campaigns)
    for (const delivery of campaign.deliveries || [])
      if (delivery.status === "sending") {
        delivery.status = "unknown";
        delivery.error = "Server restarted while sending. Reconcile in Resend.";
      }
  save();
  return {
    get state() {
      return state;
    },
    save,
    replace(next) {
      state = next;
      save();
    },
    close() {
      db.close();
    },
  };
}
