import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import type { Principal } from './auth.js';
import type { Sql } from './db.js';

/** Validate with zod; on failure send 400 and return null. */
export function parseOr400<T extends z.ZodType>(schema: T, data: unknown, reply: FastifyReply): z.infer<T> | null {
  const r = schema.safeParse(data);
  if (!r.success) {
    void reply.code(400).send({ error: 'invalid_request', issues: r.error.issues.slice(0, 5).map((i) => ({ path: i.path.join('.'), message: i.message })) });
    return null;
  }
  return r.data;
}

export async function audit(sql: Sql | null, actor: Principal | null | undefined, action: string, target: string | null, details: Record<string, unknown> = {}): Promise<void> {
  if (!sql) return;
  await sql`INSERT INTO audit_log (actor_id, actor_role, action, target, details) VALUES (${actor?.adminId ?? null}, ${actor?.role ?? null}, ${action}, ${target}, ${sql.json(details as never)})`;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The owning end-user identity of a principal (account wins over guest). */
export function ownerIds(p: Principal): string[] {
  return [p.userId, p.guestId].filter((x): x is string => !!x);
}
