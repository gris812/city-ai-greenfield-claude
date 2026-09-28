/**
 * Tokens and RBAC (D-013). HS256 JWTs via jose. Roles:
 *   guest, user                — end users (guest-first; optional account)
 *   analyst < admin < owner    — admin console / paired admin devices
 * Device tokens carry `did`; they are checked against admin_devices.revoked_at (cached 15 s).
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import type { Sql } from './db.js';

export type Role = 'guest' | 'user' | 'analyst' | 'admin' | 'owner';
export type AdminRole = 'analyst' | 'admin' | 'owner';
const ADMIN_RANK: Record<AdminRole, number> = { analyst: 1, admin: 2, owner: 3 };

export interface Principal {
  sub: string;
  role: Role;
  guestId?: string;
  userId?: string;
  adminId?: string;
  deviceId?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
  }
}

export const TOKEN_TTL = { guest: '90d', user: '90d', admin: '12h', device: '30d' } as const;

export class Auth {
  private revokedCache = new Map<string, { revoked: boolean; at: number }>();

  constructor(
    private readonly key: Uint8Array,
    private readonly sql: Sql | null,
  ) {}

  async sign(p: Principal, ttl: string): Promise<string> {
    const claims: Record<string, unknown> = { role: p.role };
    if (p.guestId) claims.gid = p.guestId;
    if (p.userId) claims.uid = p.userId;
    if (p.adminId) claims.aid = p.adminId;
    if (p.deviceId) claims.did = p.deviceId;
    return new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setSubject(p.sub).setIssuer('telvey').setIssuedAt().setExpirationTime(ttl).sign(this.key);
  }

  async verify(token: string): Promise<Principal | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: 'telvey', algorithms: ['HS256'] });
      const role = payload.role as Role;
      if (!['guest', 'user', 'analyst', 'admin', 'owner'].includes(role) || typeof payload.sub !== 'string') return null;
      const p: Principal = { sub: payload.sub, role };
      if (typeof payload.gid === 'string') p.guestId = payload.gid;
      if (typeof payload.uid === 'string') p.userId = payload.uid;
      if (typeof payload.aid === 'string') p.adminId = payload.aid;
      if (typeof payload.did === 'string') {
        p.deviceId = payload.did;
        if (await this.deviceRevoked(payload.did)) return null;
      }
      return p;
    } catch {
      return null;
    }
  }

  private async deviceRevoked(id: string): Promise<boolean> {
    const c = this.revokedCache.get(id);
    if (c && Date.now() - c.at < 15_000) return c.revoked;
    if (!this.sql) return false;
    const rows = await this.sql<{ revoked_at: Date | null }[]>`SELECT revoked_at FROM admin_devices WHERE id = ${id}`;
    const revoked = rows.length === 0 || rows[0]!.revoked_at !== null;
    this.revokedCache.set(id, { revoked, at: Date.now() });
    return revoked;
  }

  invalidateDevice(id: string): void {
    this.revokedCache.delete(id);
  }
}

export function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return h.slice(7).trim();
  const q = (req.query as Record<string, unknown> | undefined)?.token;
  return typeof q === 'string' && q.length > 0 ? q : null;
}

export function isAdminRole(r: Role): r is AdminRole {
  return r === 'analyst' || r === 'admin' || r === 'owner';
}

export function adminAtLeast(r: Role, min: AdminRole): boolean {
  return isAdminRole(r) && ADMIN_RANK[r] >= ADMIN_RANK[min];
}

export function roleAtMost(r: AdminRole, cap: AdminRole): AdminRole {
  return ADMIN_RANK[r] <= ADMIN_RANK[cap] ? r : cap;
}

/** preHandler factory: require any authenticated principal. */
export function requireAuth(auth: Auth, allowed?: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const t = bearer(req);
    const p = t ? await auth.verify(t) : null;
    if (!p) return reply.code(401).send({ error: 'unauthorized' });
    if (allowed && !allowed.includes(p.role)) return reply.code(403).send({ error: 'forbidden' });
    req.principal = p;
  };
}

/** preHandler factory: require an admin role ≥ min (RBAC). */
export function requireAdmin(auth: Auth, min: AdminRole) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const t = bearer(req);
    const p = t ? await auth.verify(t) : null;
    if (!p) return reply.code(401).send({ error: 'unauthorized' });
    if (!adminAtLeast(p.role, min)) return reply.code(403).send({ error: 'forbidden' });
    req.principal = p;
  };
}

// ─────────────────────────────────────────────── one-time codes

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Human-typable code (no ambiguous characters). */
export function oneTimeCode(len = 10): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[randomInt(alphabet.length)];
  return s;
}

export function numericCode(len = 6): string {
  let s = '';
  for (let i = 0; i < len; i++) s += String(randomInt(10));
  return s;
}

export function randomId(bytes = 16): string {
  return randomBytes(bytes).toString('base64url');
}
