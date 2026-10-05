/**
 * `pnpm --filter @city/api admin:bootstrap` (D-013): issue a one-time code (30 min) that lets
 * OWNER_EMAIL register the first owner passkey. The code is printed once to this terminal and
 * stored only as a SHA-256 hash. Refuses when an owner already exists (use invites instead),
 * unless --force is given (e.g. lost passkeys; the action is audited).
 */
import { loadConfig } from '../config.js';
import { createSql, migrate } from '../db.js';
import { oneTimeCode, sha256 } from '../auth.js';

const config = loadConfig();
const force = process.argv.includes('--force');
if (!config.ownerEmail) {
  console.error('OWNER_EMAIL is not set.');
  process.exit(2);
}
const sql = createSql(config.databaseUrl, { max: 1 });
try {
  await migrate(sql);
  const owners = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM admin_users WHERE role = 'owner' AND disabled_at IS NULL`;
  if ((owners[0]?.n ?? 0) > 0 && !force) {
    console.error('An owner already exists. Invite additional admins from the console, or re-run with --force.');
    process.exit(3);
  }
  const code = oneTimeCode(12);
  await sql`UPDATE admin_invites SET expires_at = now() WHERE kind = 'bootstrap' AND used_at IS NULL`;
  await sql`INSERT INTO admin_invites (kind, email, role, code_hash, expires_at) VALUES ('bootstrap', ${config.ownerEmail}, 'owner', ${sha256(code)}, now() + interval '30 minutes')`;
  await sql`INSERT INTO audit_log (action, target, details) VALUES ('admin.bootstrap_code_issued', ${config.ownerEmail}, ${sql.json({ force } as never)})`;
  console.log(`Bootstrap code for ${config.ownerEmail} (valid 30 minutes, single use):\n\n    ${code}\n\nOpen the admin console → "Set up passkey" and enter this code.`);
} finally {
  await sql.end({ timeout: 2 });
}
