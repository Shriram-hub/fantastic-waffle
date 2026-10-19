import {
  pgTable,
  text,
  jsonb,
  timestamp,
  integer,
  boolean,
  vector,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  profile: jsonb("profile").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
export const resumes = pgTable("resumes", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  objectKey: text("object_key"),
  contentHash: text("content_hash"),
  metadata: jsonb("metadata").notNull(),
});
export const jobs = pgTable(
  "job_listings",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    canonicalKey: text("canonical_key"),
    data: jsonb("data").notNull(),
  },
  (t) => [index("job_dedupe").on(t.userId, t.canonicalKey)],
);
export const applications = pgTable(
  "applications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id),
    stage: text("stage").notNull(),
    data: jsonb("data").notNull(),
  },
  (t) => [uniqueIndex("user_application_job").on(t.userId, t.jobId)],
);
export const contacts = pgTable("contacts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  email: text("email"),
  suppressed: boolean("suppressed").notNull().default(false),
  data: jsonb("data").notNull(),
});
export const campaigns = pgTable("campaigns", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  status: text("status").notNull(),
  data: jsonb("data").notNull(),
});
export const embeddings = pgTable(
  "embeddings",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    model: text("model").notNull(),
    contentHash: text("content_hash").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
  },
  (t) => [
    index("embedding_cosine").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
  ],
);
export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  payload: jsonb("payload").notNull(),
  runAt: timestamp("run_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
});

export const outreachSendLog = pgTable("outreach_send_log", {
  userId: text("user_id").notNull().references(() => users.id),
  contactEmail: text("contact_email").notNull(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id),
  sequenceStep: integer("sequence_step").notNull().default(0),
  taskId: text("task_id"),
  status: text("status").notNull(),
  providerId: text("provider_id"),
  updatedAt: timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
}, table => [uniqueIndex("outreach_recipient_step").on(table.userId,table.contactEmail,table.campaignId,table.sequenceStep)]);
