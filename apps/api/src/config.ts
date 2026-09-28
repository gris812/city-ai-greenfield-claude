/** API configuration from environment (validated with zod). Secrets are never logged. */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(8080),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),
  API_BASE_URL: z.string().default('http://localhost:8080'),
  DATABASE_URL: z.string().default('postgres://city:city@localhost:5432/city'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SIGNING_KEY: z.string().optional(),
  OWNER_EMAIL: z.string().optional(),
  WEBAUTHN_RP_ID: z.string().default('localhost'),
  WEBAUTHN_RP_NAME: z.string().default('Telvey Admin'),
  WEBAUTHN_ORIGIN: z.string().optional(),
  DEMO_MODE: z.string().optional(),
  AUDIO_DIR: z.string().default('./data/audio'),
  EMAIL_PROVIDER: z.string().optional(),
  EMAIL_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  BUILD_SHA: z.string().default('dev'),
  CORS_ORIGINS: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
  REALTIME_MAX_SECONDS: z.coerce.number().default(300),
  REALTIME_IDLE_TIMEOUT_S: z.coerce.number().default(20),
});

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  port: number;
  host: string;
  publicBaseUrl: string;
  apiBaseUrl: string;
  databaseUrl: string;
  redisUrl: string;
  jwtKey: Uint8Array;
  jwtKeyEphemeral: boolean;
  ownerEmail: string | null;
  webauthn: { rpId: string; rpName: string; origin: string };
  demoMode: boolean;
  audioDir: string;
  email: { provider: string; apiKey: string; from: string } | null;
  buildSha: string;
  corsOrigins: string[];
  logLevel: string;
  realtime: { maxSeconds: number; idleTimeoutS: number };
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const e = Env.parse(env);
  let jwtKey: Uint8Array;
  let ephemeral = false;
  if (e.JWT_SIGNING_KEY && e.JWT_SIGNING_KEY.length >= 32) {
    jwtKey = new Uint8Array(Buffer.from(e.JWT_SIGNING_KEY, /^[A-Za-z0-9+/=]+$/.test(e.JWT_SIGNING_KEY) ? 'base64' : 'utf8'));
  } else {
    if (e.NODE_ENV === 'production') throw new Error('JWT_SIGNING_KEY (32+ bytes, base64) is required in production');
    jwtKey = new Uint8Array(randomBytes(32));
    ephemeral = true;
  }
  const email = e.EMAIL_PROVIDER && e.EMAIL_PROVIDER !== 'none' && e.EMAIL_API_KEY && e.EMAIL_FROM ? { provider: e.EMAIL_PROVIDER, apiKey: e.EMAIL_API_KEY, from: e.EMAIL_FROM } : null;
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    publicBaseUrl: e.PUBLIC_BASE_URL,
    apiBaseUrl: e.API_BASE_URL,
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    jwtKey,
    jwtKeyEphemeral: ephemeral,
    ownerEmail: e.OWNER_EMAIL && e.OWNER_EMAIL.trim() ? e.OWNER_EMAIL.trim().toLowerCase() : null,
    webauthn: { rpId: e.WEBAUTHN_RP_ID, rpName: e.WEBAUTHN_RP_NAME, origin: e.WEBAUTHN_ORIGIN ?? e.PUBLIC_BASE_URL },
    demoMode: e.DEMO_MODE === '1',
    audioDir: e.AUDIO_DIR,
    email,
    buildSha: e.BUILD_SHA,
    corsOrigins: (e.CORS_ORIGINS ?? e.PUBLIC_BASE_URL)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    logLevel: e.LOG_LEVEL,
    realtime: { maxSeconds: e.REALTIME_MAX_SECONDS, idleTimeoutS: e.REALTIME_IDLE_TIMEOUT_S },
  };
}
