import { createPool } from '../packages/db/src';
import { seedHostedTrial } from '../packages/db/src/demo-seed';

const databaseUrl = process.env.TRIAL_SEED_DATABASE_URL;
if (!databaseUrl || !/^\/erp_trial_[a-z0-9_]+$/.test(new URL(databaseUrl).pathname)) {
  throw new Error('Set TRIAL_SEED_DATABASE_URL to a dedicated erp_trial_* database');
}

const pool = createPool(databaseUrl);
try {
  const client = await pool.connect();
  try {
    const credentials = await seedHostedTrial(client);
    console.log('Trial logins. Save securely and share only with assigned testers.');
    console.log(JSON.stringify(credentials, null, 2));
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
