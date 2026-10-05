/** Fastify application factory (used by server.ts and integration tests). */
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppDeps } from './deps.js';
import { loggerOptions } from './logger.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { publicRoutes } from './routes/public.js';
import { sessionRoutes } from './routes/sessions.js';
import { toolRoutes } from './routes/tools.js';

export interface BuildAppOptions {
  logger?: boolean;
  /** Disable rate limiting (load tests). */
  rateLimit?: boolean;
}

export async function buildApp(deps: AppDeps, opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : loggerOptions(deps.config.logLevel),
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });
  await app.register(cors, { origin: deps.config.corsOrigins, credentials: false, methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] });
  if (opts.rateLimit !== false) {
    await app.register(rateLimit, {
      global: true,
      max: 600,
      timeWindow: '1 minute',
      skipOnError: true, // Redis down → do not take the API down with it (F5)
      ...(deps.redis ? { redis: deps.redis, nameSpace: 'rl:' } : {}),
      keyGenerator: (req) => req.ip,
    });
  }
  await app.register(websocket, { options: { maxPayload: 256 * 1024 } });
  app.setErrorHandler((e, _req, reply) => {
    const err = e as Error & { statusCode?: number };
    const status = err.statusCode ?? 500;
    if (status >= 500) app.log.error({ err: { message: err.message, name: err.name } }, 'request failed');
    void reply.code(status).send({ error: status >= 500 ? 'internal' : err.message, retryable: status >= 500 || status === 429 });
  });
  publicRoutes(app, deps);
  authRoutes(app, deps);
  sessionRoutes(app, deps);
  toolRoutes(app, deps);
  adminRoutes(app, deps);
  return app;
}
