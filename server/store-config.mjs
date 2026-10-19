import { openStore } from './store.mjs';
import { openPostgresStore } from './db/postgres-store.mjs';
export async function openConfiguredStore(config = process.env) {
  config.PUBLIC_BASE_URL ||= config.RENDER_EXTERNAL_URL || "http://127.0.0.1:3000";
  return config.DATABASE_URL ? openPostgresStore(config) : openStore(config.DATA_DIR || './data');
}
