/** `pnpm --filter @city/api migrate` — apply SQL migrations. */
import { loadConfig } from '../config.js';
import { createSql, migrate } from '../db.js';

const sql = createSql(loadConfig().databaseUrl, { max: 1 });
try {
  const applied = await migrate(sql);
  console.log(applied.length ? `applied: ${applied.join(', ')}` : 'up to date');
} finally {
  await sql.end({ timeout: 2 });
}
