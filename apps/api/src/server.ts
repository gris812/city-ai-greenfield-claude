/** API entry point: migrate, wire dependencies, listen, graceful shutdown. */
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { migrate } from './db.js';
import { createDeps } from './deps.js';

const config = loadConfig();
const deps = await createDeps(config);
if (deps.sql && process.env.SKIP_MIGRATIONS !== '1') {
  const applied = await migrate(deps.sql);
  if (applied.length) console.log(JSON.stringify({ level: 30, msg: 'migrations applied', applied }));
}
const app = await buildApp(deps);
if (config.jwtKeyEphemeral) app.log.warn('JWT_SIGNING_KEY not set: using an ephemeral key (tokens reset on restart; dev only)');
if (config.demoMode) app.log.warn('DEMO_MODE=1: fixture places/evidence are active and labelled simulated (D-005)');

const shutdown = async (sig: string) => {
  app.log.info({ sig }, 'shutting down');
  try {
    await app.close();
    await deps.close();
  } finally {
    process.exit(0);
  }
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.port, host: config.host });
