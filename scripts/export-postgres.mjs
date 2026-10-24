import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { readFile } from "node:fs/promises";
import { openStore } from "../server/store.mjs";
import * as schema from "../server/db/postgres-schema.mjs";
import { canonicalJobKey } from "../server/providers/jobs/index.mjs";
if (!process.env.DATABASE_URL)
  throw Error(
    "Set DATABASE_URL to an explicitly selected export target. This does not change the application runtime database.",
  );
if (!process.argv.includes("--confirm-export"))
  throw Error(
    "Pass --confirm-export to provision the PostgreSQL target and export the core records.",
  );
const source = openStore(process.env.DATA_DIR || "./data"),
  client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query(
    await readFile(
      new URL("../server/db/postgres.sql", import.meta.url),
      "utf8",
    ),
  );
  const db = drizzle(client),
    state = source.state,
    userId = process.env.EXPORT_USER_ID || "local";
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.users)
      .values({
        id: userId,
        email: state.profile.email || "",
        profile: state.profile,
      })
      .onConflictDoNothing();
    if (state.resume) {
      const { base64, ...metadata } = state.resume;
      await tx
        .insert(schema.resumes)
        .values({
          id: `${userId}-current`,
          userId,
          objectKey: state.resume.storage?.key || null,
          contentHash: state.resume.contentHash || null,
          metadata,
        })
        .onConflictDoNothing();
    }
    for (const job of state.jobs)
      await tx
        .insert(schema.jobs)
        .values({
          id: `${userId}:${job.id}`,
          userId,
          canonicalKey: canonicalJobKey(job),
          data: job,
        })
        .onConflictDoNothing();
    for (const a of state.applications)
      await tx
        .insert(schema.applications)
        .values({
          id: `${userId}:${a.id}`,
          userId,
          jobId: `${userId}:${a.jobId}`,
          stage: a.stage,
          data: a,
        })
        .onConflictDoNothing();
    for (const c of state.contacts) {
      if (c.companyDomain) await tx.insert(schema.companies).values({domain:c.companyDomain,name:c.company}).onConflictDoNothing();
      await tx
        .insert(schema.contacts)
        .values({
          id: `${userId}:${c.id}`,
          userId,
          email: c.email || null,
          jobId: c.jobId ? `${userId}:${c.jobId}` : null,
          companyDomain: c.companyDomain || null,
          suppressed: c.suppressed,
          data: c,
        })
        .onConflictDoNothing();
    }
    const matrix = source.db.prepare("SELECT body FROM search_matrices WHERE id='current'").get();
    if (matrix) await tx.insert(schema.searchMatrices).values({userId,data:JSON.parse(matrix.body)}).onConflictDoNothing();
    for (const c of state.campaigns)
      await tx
        .insert(schema.campaigns)
        .values({ id: `${userId}:${c.id}`, userId, status: c.status, data: c })
        .onConflictDoNothing();
    const embedded = source.db.prepare("SELECT * FROM embeddings").all();
    for (const e of embedded) {
      const vector = JSON.parse(e.vector);
      if (vector.length !== 1536)
        throw Error(
          "The export target expects 1536 dimensions. Adjust the PostgreSQL schema for your model first.",
        );
      await tx
        .insert(schema.embeddings)
        .values({
          id: `${userId}:${e.id}`,
          userId,
          model: e.model,
          contentHash: e.content_hash,
          embedding: vector,
        })
        .onConflictDoNothing();
    }
  });
  console.log(
    "Core-record export completed. Mailbox credentials, secrets, queued tasks, inbox messages, public links, and file bytes were intentionally not transferred. Runtime cutover and reconciliation are still required.",
  );
} finally {
  source.close();
  await client.end();
}
