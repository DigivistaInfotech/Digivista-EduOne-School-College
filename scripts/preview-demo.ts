// A loopback-only preview with a disposable synthetic database. It never uses
// the configured school database and never modifies the normal development setup.
process.env.DATABASE_URL = 'postgres://postgres:postgres@127.0.0.1:5433/school_erp_preview_placeholder';
process.env.NODE_ENV = 'test';
process.env.APP_ORIGIN = 'http://127.0.0.1:5173';
process.env.COOKIE_SECURE = 'false';

const { startTestDatabase } = await import('../packages/db/src/test-database');
const database = await startTestDatabase();
process.env.DATABASE_URL = database.url;
const { buildApp } = await import('../apps/api/src/app');
const { closePool, getPool } = await import('../apps/api/src/db');
const { runHighScaleDemoSeed } = await import('../packages/db/src/demo-seed');
const { seedEnrichmentPreview } = await import('./seed-enrichment-preview');
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
let closing = false;

async function close() {
  if (closing) return;
  closing = true;
  await app?.close();
  await closePool();
  await database.stop();
}

try {
  const client = await getPool().connect();
  try { await runHighScaleDemoSeed(client); await seedEnrichmentPreview(client); } finally { client.release(); }
  app = await buildApp();
  await app.listen({ host: '127.0.0.1', port: 4000 });
  console.log('Synthetic demo API ready on http://127.0.0.1:4000. Open the existing web preview on port 5173.');
  process.on('SIGINT', () => { void close().then(() => process.exit(0)); });
  process.on('SIGTERM', () => { void close().then(() => process.exit(0)); });
} catch (error) {
  await close();
  throw error;
}
