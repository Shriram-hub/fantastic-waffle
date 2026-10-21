import { openStore } from './store.mjs';
import { openPostgresStore } from './db/postgres-store.mjs';
export async function openConfiguredStore(config = process.env) {
  // Leave an unknown origin unset so request-bound OAuth/extension routes can
  // derive it from the validated live host rather than pinning localhost.
  const publicURL=config.PUBLIC_APP_URL || config.RENDER_EXTERNAL_URL;
  if(!config.PUBLIC_BASE_URL && publicURL)config.PUBLIC_BASE_URL=publicURL;
  return config.DATABASE_URL ? openPostgresStore(config) : openStore(config.DATA_DIR || './data');
}
