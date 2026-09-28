/**
 * Optional end-user accounts (email OTP, 501 when no email provider) and admin auth:
 * WebAuthn passkeys gated by one-time bootstrap/invite codes, and mobile device pairing (D-013).
 */
import type { FastifyInstance } from 'fastify';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import { z } from 'zod';
import { defaultFetch } from '@city/providers';
import { TOKEN_TTL, numericCode, requireAdmin, roleAtMost, sha256, oneTimeCode, type AdminRole } from '../auth.js';
import type { AppDeps } from '../deps.js';
import { audit, parseOr400 } from '../util.js';

const Email = z.string().trim().toLowerCase().email().max(200);

async function sendEmail(deps: AppDeps, to: string, subject: string, text: string): Promise<void> {
  const e = deps.config.email!;
  const f = defaultFetch;
  if (e.provider === 'resend') {
    const r = await f('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${e.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: e.from, to, subject, text }) });
    if (!r.ok) throw new Error(`email provider HTTP ${r.status}`);
  } else if (e.provider === 'postmark') {
    const r = await f('https://api.postmarkapp.com/email', { method: 'POST', headers: { 'X-Postmark-Server-Token': e.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ From: e.from, To: to, Subject: subject, TextBody: text }) });
    if (!r.ok) throw new Error(`email provider HTTP ${r.status}`);
  } else throw new Error('unsupported email provider');
}

export function authRoutes(app: FastifyInstance, deps: AppDeps): void {
  const sql = deps.sql;
  const strict = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  // ── End-user OTP
  app.post('/v1/auth/otp/start', strict, async (req, reply) => {
    if (!deps.config.email || !sql) return reply.code(501).send({ error: 'email_not_configured' });
    const b = parseOr400(z.object({ email: Email }), req.body, reply);
    if (!b) return;
    const recent = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM otp_codes WHERE email = ${b.email} AND created_at > now() - interval '10 minutes'`;
    if ((recent[0]?.n ?? 0) >= 3) return reply.code(429).send({ error: 'too_many_codes' });
    const code = numericCode(6);
    await sql`INSERT INTO otp_codes (email, code_hash, expires_at) VALUES (${b.email}, ${sha256(`${b.email}:${code}`)}, now() + interval '10 minutes')`;
    try {
      await sendEmail(deps, b.email, 'Your Telvey sign-in code', `Your code is ${code}. It expires in 10 minutes.`);
    } catch {
      return reply.code(502).send({ error: 'email_failed', retryable: true });
    }
    return { ok: true };
  });

  app.post('/v1/auth/otp/verify', strict, async (req, reply) => {
    if (!deps.config.email || !sql) return reply.code(501).send({ error: 'email_not_configured' });
    const b = parseOr400(z.object({ email: Email, code: z.string().regex(/^\d{6}$/), guestToken: z.string().optional() }), req.body, reply);
    if (!b) return;
    const [row] = await sql<{ id: string; code_hash: string; attempts: number }[]>`
      SELECT id, code_hash, attempts FROM otp_codes WHERE email = ${b.email} AND used_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1`;
    if (!row || row.attempts >= 5) return reply.code(401).send({ error: 'invalid_code' });
    if (row.code_hash !== sha256(`${b.email}:${b.code}`)) {
      await sql`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ${row.id}`;
      return reply.code(401).send({ error: 'invalid_code' });
    }
    await sql`UPDATE otp_codes SET used_at = now() WHERE id = ${row.id}`;
    const [user] = await sql<{ id: string; email: string }[]>`INSERT INTO users (email) VALUES (${b.email}) ON CONFLICT (email) DO UPDATE SET deleted_at = NULL RETURNING id, email`;
    const guest = b.guestToken ? await deps.auth.verify(b.guestToken) : null;
    if (guest?.guestId) {
      // Merge the guest's history into the account.
      await sql`UPDATE guests SET user_id = ${user!.id} WHERE id = ${guest.guestId}`;
      await sql`UPDATE sessions SET user_id = ${user!.id} WHERE guest_id = ${guest.guestId}`;
    }
    const token = await deps.auth.sign({ sub: user!.id, role: 'user', userId: user!.id, ...(guest?.guestId ? { guestId: guest.guestId } : {}) }, TOKEN_TTL.user);
    return { token, user: { id: user!.id, email: user!.email } };
  });

  // ── Admin WebAuthn
  const rp = deps.config.webauthn;
  const challengeKey = (kind: string, email: string) => `wa:${kind}:${sha256(email)}`;

  async function validInvite(email: string, code: string) {
    if (!sql) return null;
    const [inv] = await sql<{ id: string; role: AdminRole; kind: string }[]>`
      SELECT id, role, kind FROM admin_invites WHERE email = ${email} AND code_hash = ${sha256(code.trim().toUpperCase())} AND used_at IS NULL AND expires_at > now() LIMIT 1`;
    return inv ?? null;
  }

  app.post('/v1/admin/webauthn/register/options', strict, async (req, reply) => {
    const b = parseOr400(z.object({ email: Email, code: z.string().min(6).max(40) }), req.body, reply);
    if (!b || !sql) return;
    const inv = await validInvite(b.email, b.code);
    if (!inv) return reply.code(401).send({ error: 'invalid_code' });
    const existing = await sql<{ id: string; transports: string[] }[]>`
      SELECT c.id, c.transports FROM webauthn_credentials c JOIN admin_users u ON u.id = c.admin_user_id WHERE u.email = ${b.email}`;
    const opts = await generateRegistrationOptions({
      rpName: rp.rpName,
      rpID: rp.rpId,
      userName: b.email,
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports as never })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });
    await deps.kv.set(challengeKey('reg', b.email), opts.challenge, 300);
    return opts;
  });

  app.post('/v1/admin/webauthn/register/verify', strict, async (req, reply) => {
    const b = parseOr400(z.object({ email: Email, code: z.string().min(6).max(40), response: z.record(z.string(), z.unknown()) }), req.body, reply);
    if (!b || !sql) return;
    const inv = await validInvite(b.email, b.code);
    if (!inv) return reply.code(401).send({ error: 'invalid_code' });
    const challenge = await deps.kv.get(challengeKey('reg', b.email));
    if (!challenge) return reply.code(400).send({ error: 'challenge_expired' });
    let v;
    try {
      v = await verifyRegistrationResponse({ response: b.response as never, expectedChallenge: challenge, expectedOrigin: rp.origin, expectedRPID: rp.rpId });
    } catch {
      return reply.code(400).send({ error: 'verification_failed' });
    }
    if (!v.verified) return reply.code(400).send({ error: 'verification_failed' });
    await deps.kv.del(challengeKey('reg', b.email));
    const cred = v.registrationInfo.credential;
    const admin = await sql.begin(async (tx) => {
      const [u] = await tx<{ id: string; role: AdminRole }[]>`
        INSERT INTO admin_users (email, role) VALUES (${b.email}, ${inv.role})
        ON CONFLICT (email) DO UPDATE SET disabled_at = NULL RETURNING id, role`;
      await tx`INSERT INTO webauthn_credentials (id, admin_user_id, public_key, counter, transports) VALUES (${cred.id}, ${u!.id}, ${Buffer.from(cred.publicKey)}, ${cred.counter}, ${(cred.transports ?? []) as string[]})`;
      await tx`UPDATE admin_invites SET used_at = now() WHERE id = ${inv.id}`;
      return u!;
    });
    const principal = { sub: admin.id, role: admin.role, adminId: admin.id };
    await audit(sql, principal, 'admin.passkey_registered', admin.id, { via: inv.kind });
    return { token: await deps.auth.sign(principal, TOKEN_TTL.admin), role: admin.role };
  });

  app.post('/v1/admin/webauthn/login/options', strict, async (req, reply) => {
    const b = parseOr400(z.object({ email: Email }), req.body, reply);
    if (!b || !sql) return;
    const creds = await sql<{ id: string; transports: string[] }[]>`
      SELECT c.id, c.transports FROM webauthn_credentials c JOIN admin_users u ON u.id = c.admin_user_id WHERE u.email = ${b.email} AND u.disabled_at IS NULL`;
    const opts = await generateAuthenticationOptions({ rpID: rp.rpId, allowCredentials: creds.map((c) => ({ id: c.id, transports: c.transports as never })), userVerification: 'preferred' });
    await deps.kv.set(challengeKey('auth', b.email), opts.challenge, 300);
    return opts; // same shape whether or not the email exists (no account enumeration beyond allowCredentials)
  });

  app.post('/v1/admin/webauthn/login/verify', strict, async (req, reply) => {
    const b = parseOr400(z.object({ email: Email, response: z.object({ id: z.string() }).passthrough() }), req.body, reply);
    if (!b || !sql) return;
    const challenge = await deps.kv.get(challengeKey('auth', b.email));
    if (!challenge) return reply.code(400).send({ error: 'challenge_expired' });
    const [c] = await sql<{ id: string; public_key: Buffer; counter: string; transports: string[]; admin_user_id: string; role: AdminRole }[]>`
      SELECT c.id, c.public_key, c.counter::text, c.transports, c.admin_user_id, u.role FROM webauthn_credentials c JOIN admin_users u ON u.id = c.admin_user_id
      WHERE c.id = ${b.response.id} AND u.email = ${b.email} AND u.disabled_at IS NULL`;
    if (!c) return reply.code(401).send({ error: 'unknown_credential' });
    let v;
    try {
      v = await verifyAuthenticationResponse({ response: b.response as never, expectedChallenge: challenge, expectedOrigin: rp.origin, expectedRPID: rp.rpId, credential: { id: c.id, publicKey: new Uint8Array(c.public_key), counter: Number(c.counter), transports: c.transports as never } });
    } catch {
      return reply.code(401).send({ error: 'verification_failed' });
    }
    if (!v.verified) return reply.code(401).send({ error: 'verification_failed' });
    await deps.kv.del(challengeKey('auth', b.email));
    await sql`UPDATE webauthn_credentials SET counter = ${v.authenticationInfo.newCounter}, last_used_at = now() WHERE id = ${c.id}`;
    const principal = { sub: c.admin_user_id, role: c.role, adminId: c.admin_user_id };
    await audit(sql, principal, 'admin.login', c.admin_user_id, {});
    return { token: await deps.auth.sign(principal, TOKEN_TTL.admin), role: c.role };
  });

  // ── Mobile admin pairing
  app.post('/v1/admin/pairing', { preHandler: requireAdmin(deps.auth, 'analyst'), ...strict }, async (req, reply) => {
    const p = req.principal!;
    if (!sql || !p.adminId) return reply.code(403).send({ error: 'forbidden' });
    if (p.deviceId) return reply.code(403).send({ error: 'devices_cannot_pair' });
    const code = oneTimeCode(8);
    const expiresAt = Date.now() + 5 * 60_000;
    await sql`INSERT INTO pairing_codes (code_hash, admin_user_id, role, expires_at) VALUES (${sha256(code)}, ${p.adminId}, ${p.role}, ${new Date(expiresAt)})`;
    await audit(sql, p, 'admin.pairing_issued', p.adminId, {});
    return { code, qrPayload: `telvey://pair?code=${code}&api=${encodeURIComponent(deps.config.apiBaseUrl)}`, expiresAt };
  });

  app.post('/v1/admin/pairing/redeem', strict, async (req, reply) => {
    const b = parseOr400(z.object({ code: z.string().min(6).max(20), deviceName: z.string().trim().min(1).max(80) }), req.body, reply);
    if (!b || !sql) return;
    const result = await sql.begin(async (tx) => {
      const [pc] = await tx<{ admin_user_id: string; role: AdminRole }[]>`
        UPDATE pairing_codes SET used_at = now() WHERE code_hash = ${sha256(b.code.trim().toUpperCase())} AND used_at IS NULL AND expires_at > now()
        RETURNING admin_user_id, role`;
      if (!pc) return null;
      const [u] = await tx<{ role: AdminRole; disabled_at: Date | null }[]>`SELECT role, disabled_at FROM admin_users WHERE id = ${pc.admin_user_id}`;
      if (!u || u.disabled_at) return null;
      const role = roleAtMost(pc.role, u.role); // device role ≤ issuer's current role
      const [d] = await tx<{ id: string }[]>`INSERT INTO admin_devices (admin_user_id, name, role) VALUES (${pc.admin_user_id}, ${b.deviceName}, ${role}) RETURNING id`;
      return { adminId: pc.admin_user_id, role, deviceId: d!.id };
    });
    if (!result) return reply.code(401).send({ error: 'invalid_code' });
    const principal = { sub: result.adminId, role: result.role, adminId: result.adminId, deviceId: result.deviceId };
    await audit(sql, principal, 'admin.device_paired', result.deviceId, { name: b.deviceName });
    return { token: await deps.auth.sign(principal, TOKEN_TTL.device), deviceId: result.deviceId, role: result.role };
  });
}
