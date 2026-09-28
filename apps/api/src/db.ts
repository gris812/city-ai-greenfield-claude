/**
 * Postgres access (porsager `postgres`) and a tiny SQL migration runner:
 * apps/api/migrations/NNN_name.sql applied in order inside a transaction, guarded by an
 * advisory lock, recorded in schema_migrations.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

export type Sql = postgres.Sql<Record<string, never>>;

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export function createSql(url: string, opts: { max?: number } = {}): Sql {
  return postgres(url, {
    max: opts.max ?? 10,
    idle_timeout: 30,
    connect_timeout: 5,
    onnotice: () => {},
  }) as unknown as Sql;
}

export async function migrate(sql: Sql, dir = MIGRATIONS_DIR): Promise<string[]> {
  const files = readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
  const applied: string[] = [];
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(74185001)`;
    await tx`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const done = new Set((await tx<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      await tx.unsafe(readFileSync(join(dir, f), 'utf8'));
      await tx`INSERT INTO schema_migrations (name) VALUES (${f})`;
      applied.push(f);
    }
  });
  return applied;
}

export async function dbHealthy(sql: Sql): Promise<boolean> {
  try {
    await Promise.race([sql`SELECT 1`, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 1500))]);
    return true;
  } catch {
    return false;
  }
}
