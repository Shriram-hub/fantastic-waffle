-- Optional pgvector export schema. The live private-workspace runtime uses runtime.sql.
-- Select the intended embedding model/dimensions before running a production cutover.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS users(id text PRIMARY KEY,email text NOT NULL,profile jsonb NOT NULL,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS resumes(id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),object_key text,content_hash text,metadata jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS job_listings(id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),canonical_key text,data jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS job_dedupe ON job_listings(user_id,canonical_key);
CREATE TABLE IF NOT EXISTS applications(id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),job_id text NOT NULL REFERENCES job_listings(id),stage text NOT NULL,data jsonb NOT NULL,UNIQUE(user_id,job_id));
CREATE TABLE IF NOT EXISTS contacts(id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),email text,suppressed boolean NOT NULL DEFAULT false,data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS campaigns(id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),status text NOT NULL,data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS embeddings(id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),model text NOT NULL,content_hash text NOT NULL,embedding vector(1536) NOT NULL);
CREATE INDEX IF NOT EXISTS embedding_cosine ON embeddings USING hnsw(embedding vector_cosine_ops);
CREATE TABLE IF NOT EXISTS tasks(id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),kind text NOT NULL,status text NOT NULL,payload jsonb NOT NULL,run_at timestamptz NOT NULL,attempts integer NOT NULL DEFAULT 0);

-- A follow-up is a distinct step; a worker restart cannot claim the same step twice.
CREATE TABLE IF NOT EXISTS outreach_send_log(user_id text NOT NULL REFERENCES users(id),contact_email text NOT NULL,campaign_id text NOT NULL REFERENCES campaigns(id),sequence_step integer NOT NULL DEFAULT 0,task_id text,status text NOT NULL,provider_id text,updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,contact_email,campaign_id,sequence_step));
