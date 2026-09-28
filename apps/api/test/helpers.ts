/**
 * Integration harness: real Postgres + Redis (see docs/DEPLOY.md / CI services), deterministic
 * fake providers, fixture places/evidence (tests only, D-005), a listening Fastify server and
 * a small WebSocket client.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import type { ContextFrame, GeoFix } from '@city/core';
import { FakeNearbySearch, FakeRealtimeTokenIssuer, FakeSpeechRecognizer, FakeSpeechSynthesizer, FakeTextGenerator, type ProviderSet } from '@city/providers';
import { loadTrace } from '@city/replay';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createSql, migrate, type Sql } from '../src/db.js';
import { createDeps, type AppDeps, type DepsOverrides } from '../src/deps.js';
import { MemoryKV, ResilientKV, type KV } from '../src/kv.js';
import type { FastifyInstance } from 'fastify';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://city:city@localhost:5432/city_test';
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15';
export const JWT_KEY = Buffer.from('test-signing-key-0123456789abcdef-0123456789').toString('base64');

export async function servicesAvailable(): Promise<boolean> {
  const sql = createSql(TEST_DATABASE_URL, { max: 1 });
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

export async function resetDatabase(): Promise<void> {
  const sql = createSql(TEST_DATABASE_URL, { max: 1 });
  try {
    await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await migrate(sql);
  } finally {
    await sql.end({ timeout: 2 });
  }
}

export interface TestProviders {
  story: FakeTextGenerator;
  intent: FakeTextGenerator;
  tts: FakeSpeechSynthesizer;
  nearby: FakeNearbySearch;
}

export interface TestApp {
  app: FastifyInstance;
  deps: AppDeps;
  base: string;
  ws: string;
  fakes: TestProviders;
  close(): Promise<void>;
}

export interface TestAppOptions {
  kv?: 'redis' | 'memory' | 'broken';
  providers?: Partial<ProviderSet>;
  overrides?: DepsOverrides;
  fakes?: Partial<TestProviders>;
}

export async function startTestApp(o: TestAppOptions = {}): Promise<TestApp> {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: TEST_REDIS_URL,
    JWT_SIGNING_KEY: JWT_KEY,
    AUDIO_DIR: mkdtempSync(join(tmpdir(), 'telvey-audio-')),
    API_BASE_URL: 'http://127.0.0.1:0',
    OWNER_EMAIL: 'owner@example.org',
    LOG_LEVEL: 'silent',
  });
  let kv: KV;
  if (o.kv === 'memory') kv = new MemoryKV();
  else if (o.kv === 'broken') kv = new ResilientKV('redis://127.0.0.1:1/0'); // nothing listens → reduced mode
  else {
    const r = new ResilientKV(TEST_REDIS_URL);
    await waitFor(() => r.redis.status === 'ready', 3000);
    await r.redis.flushdb();
    kv = r;
  }
  const fakes: TestProviders = {
    story: o.fakes?.story ?? new FakeTextGenerator({ latencyMs: 5 }),
    intent: o.fakes?.intent ?? new FakeTextGenerator({ latencyMs: 5 }),
    tts: o.fakes?.tts ?? new FakeSpeechSynthesizer({ latencyMs: 5 }),
    nearby: o.fakes?.nearby ?? new FakeNearbySearch({ latencyMs: 5, includeInvalid: true }),
  };
  const sql = createSql(TEST_DATABASE_URL, { max: 5 });
  const deps = await createDeps(config, {
    sql,
    kv,
    fixtures: true,
    telemetryFlushMs: 200,
    ...o.overrides,
    providers: { story: [fakes.story], intent: [fakes.intent], tts: [fakes.tts], stt: [new FakeSpeechRecognizer()], realtime: [new FakeRealtimeTokenIssuer()], nearby: [fakes.nearby], ...o.providers, ...(o.overrides?.providers ?? {}) },
  });
  const app = await buildApp(deps, { logger: false, rateLimit: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    app,
    deps,
    fakes,
    base: `http://127.0.0.1:${port}`,
    ws: `ws://127.0.0.1:${port}`,
    async close() {
      await app.close();
      await deps.close();
    },
  };
}

export async function waitFor(pred: () => boolean, timeoutMs = 2000, stepMs = 10): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

export async function http<T = any>(base: string, method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; body: T }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  return { status: res.status, body: parsed as T };
}

export async function guest(base: string): Promise<string> {
  const r = await http<{ token: string }>(base, 'POST', '/v1/guest');
  return r.body.token;
}

export async function newSession(base: string, token: string, body: Record<string, unknown> = {}): Promise<string> {
  const r = await http<{ sessionId: string }>(base, 'POST', '/v1/sessions', { guideId: 'ida', locale: 'en-US', simulated: true, client: { platform: 'test', appVersion: '0' }, ...body }, token);
  if (r.status !== 201) throw new Error(`session create failed ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.sessionId;
}

export function frameOf(fix: GeoFix, seq: number, audio: Partial<ContextFrame['audio']> = {}): Omit<ContextFrame, 'sessionId'> {
  return { seq, fixes: [fix], route: null, appState: 'foreground', audio: { playing: false, outputRoute: 'headphones', ...audio }, lastInteractionAt: null, clientTime: fix.t, simulated: true };
}

export function traceFixes(name: string): GeoFix[] {
  return loadTrace(name).fixes;
}

export interface Env {
  type: string;
  seq: number;
  turn: number | null;
  ref?: string;
  directive: any;
}

export class WsClient {
  readonly messages: any[] = [];
  private waiters: Array<{ pred: (m: any) => boolean; resolve: (m: any) => void; from: number }> = [];
  constructor(readonly sock: WebSocket) {
    sock.on('message', (d) => {
      const m = JSON.parse(d.toString());
      this.messages.push(m);
      for (const w of [...this.waiters]) {
        if (w.pred(m)) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          w.resolve(m);
        }
      }
    });
  }
  static async connect(url: string): Promise<WsClient> {
    const s = new WebSocket(url);
    const c = new WsClient(s);
    await new Promise<void>((res, rej) => {
      s.once('open', () => res());
      s.once('error', rej);
    });
    await c.next((m) => m.type === 'hello');
    return c;
  }
  send(x: unknown): void {
    this.sock.send(JSON.stringify(x));
  }
  directives(): Env[] {
    return this.messages.filter((m) => m.type === 'directive');
  }
  /** Resolve with the first message (already received after `from`, or future) matching pred. */
  next(pred: (m: any) => boolean, timeoutMs = 5000, from = 0): Promise<any> {
    const hit = this.messages.slice(from).find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve, from };
      this.waiters.push(w);
      setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) {
          this.waiters.splice(i, 1);
          reject(new Error(`ws wait timeout; last: ${JSON.stringify(this.messages.slice(-3)).slice(0, 600)}`));
        }
      }, timeoutMs);
    });
  }
  directive(type: string, from = 0, timeoutMs = 5000, extra: (e: Env) => boolean = () => true): Promise<Env> {
    return this.next((m) => m.type === 'directive' && m.directive.type === type && extra(m), timeoutMs, from);
  }
  close(): Promise<void> {
    return new Promise((r) => {
      this.sock.once('close', () => r());
      this.sock.close();
    });
  }
}

export function sqlFor(deps: AppDeps): Sql {
  return deps.sql!;
}
