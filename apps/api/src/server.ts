import { waitForDatabase } from '@erp/db';
import { buildApp } from './app';
import { config } from './config';
import { closePool } from './db';

if (config.managedWeb && (!config.isProduction || !config.cookieSecure ||
    new URL(config.appOrigin).protocol !== 'https:' ||
    new URL(config.databaseUrl).searchParams.get('sslmode') !== 'verify-full')) {
  throw new Error('Managed web deployments require production mode, HTTPS, secure cookies and verified database TLS');
}

if (config.managedWeb && (config.trialEnabled || config.managedTrialPassword !== undefined) &&
    (config.trialExpiresAt === undefined || (config.managedTrialPassword?.length ?? 0) < 20)) {
  throw new Error('Managed trials require a dated expiry and a strong staff access password');
}

if (config.isProduction && config.trialEnabled) {
  if ((!config.managedWeb && config.host !== '127.0.0.1') || !config.cookieSecure || new URL(config.appOrigin).protocol !== 'https:') {
    throw new Error('Hosted trials require loopback API binding, an HTTPS app origin and secure cookies');
  }
  if (!/^\/erp_trial_[a-z0-9_]+$/.test(new URL(config.databaseUrl).pathname)) {
    throw new Error('Hosted trials require a dedicated erp_trial_* database');
  }
}

const app = await buildApp({ logger: true });

try {
  await waitForDatabase(config.databaseUrl, 60);
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`API listening on http://localhost:${config.port}`);
  app.log.info(`Allowed browser origin: ${config.appOrigin}`);
} catch (error) {
  app.log.error(error, 'Failed to start API');
  await closePool();
  process.exit(1);
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info(`Received ${signal}; shutting down`);
  try {
    await app.close();
    await closePool();
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
