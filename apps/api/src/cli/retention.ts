/** `pnpm --filter @city/api retention` — D-012 retention job (schedule daily, e.g. cron in the api container). */
import { loadConfig } from '../config.js';
import { createSql } from '../db.js';

const sql = createSql(loadConfig().databaseUrl, { max: 1 });
try {
  const [r] = await sql<{ run_retention: Record<string, number> }[]>`SELECT run_retention()`;
  console.log(JSON.stringify({ retention: r?.run_retention ?? null, at: new Date().toISOString() }));
} finally {
  await sql.end({ timeout: 2 });
}
