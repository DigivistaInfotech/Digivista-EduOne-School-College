import pg from 'pg';
import { LIVE_DEMO_DOMAIN, seedLiveDemo } from '../packages/db/src/demo-seed';
import { seedEnrichmentPreview } from './seed-enrichment-preview';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Live demo seeding requires DATABASE_URL');
const target = new URL(databaseUrl);
if (target.pathname !== '/schoolerp' || !target.hostname.endsWith('.neon.tech') ||
    target.searchParams.get('sslmode') !== 'verify-full') {
  throw new Error('Live demo seeding requires the verified schoolerp database');
}
const passwords = JSON.parse(process.env.SCHOOLERP_LIVE_DEMO_PASSWORDS ?? '{}') as Record<string, string>;
for (const username of ['admin', 'finance', 'teacher', 'parent', 'student', 'principal', 'management', 'schooladmin']) {
  if (typeof passwords[username] !== 'string' || passwords[username].length < 24) {
    throw new Error(`Missing secure demo credential for ${username}`);
  }
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 5_000,
  application_name: 'school-erp-live-demo-seed',
});
try {
  const client = await pool.connect();
  client.on('error', () => {
    console.error('The live demo database connection closed during seeding.');
  });
  try {
    const summary = await seedLiveDemo(client, passwords, async (schoolId) => {
      await client.query('SELECT seed_institution_masters($1), seed_library_categories($1), seed_transport_masters($1), seed_academic_profile_masters($1)', [schoolId]);
      await seedEnrichmentPreview(client, { schoolId, domain: LIVE_DEMO_DOMAIN, passwords });
    });
    console.log(JSON.stringify({ ...summary, demoUsers: undefined }, null, 2));
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
