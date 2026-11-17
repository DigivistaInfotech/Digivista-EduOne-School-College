import { hashPassword } from '@erp/core';
import { userInput } from '@erp/shared';
import { createPool } from '../packages/db/src';
import { seedReferenceData } from '../packages/db/src/seed';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/schoolerp') {
  throw new Error('Set DATABASE_URL to the migrated schoolerp database');
}

const schoolName = process.env.SCHOOLERP_SCHOOL_NAME?.trim() ?? '';
const schoolCode = process.env.SCHOOLERP_SCHOOL_CODE?.trim() ?? '';
const owner = userInput.safeParse({
  email: process.env.SCHOOLERP_OWNER_EMAIL,
  displayName: process.env.SCHOOLERP_OWNER_NAME,
  password: process.env.SCHOOLERP_OWNER_PASSWORD,
  roleCode: 'main_admin',
  scopeType: 'school',
});
if (!schoolName || schoolName.length > 200 || !/^[A-Z0-9_-]{1,40}$/.test(schoolCode) || !owner.success) {
  throw new Error('Provide a school name and code, plus a valid owner name, email and strong password');
}

const passwordHash = await hashPassword(owner.data.password);
const pool = createPool(databaseUrl);
try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE schools, users IN SHARE ROW EXCLUSIVE MODE');
    const { rows: [state] } = await client.query<{ populated: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM schools) OR EXISTS (SELECT 1 FROM users) AS populated',
    );
    if (state?.populated !== false) throw new Error('Initial setup requires an empty schoolerp database');

    const roles = await seedReferenceData(client);
    const { rows: [school] } = await client.query<{ id: string }>(
      'INSERT INTO schools (code, name) VALUES ($1, $2) RETURNING id',
      [schoolCode, schoolName],
    );
    const { rows: [user] } = await client.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash, status)
       VALUES ($1, $2, $3, 'active') RETURNING id`,
      [owner.data.email, owner.data.displayName, passwordHash],
    );
    await client.query(
      `INSERT INTO user_role_assignments (user_id, role_id, school_id, scope_type, reason)
       VALUES ($1, $2, $3, 'school', 'Initial school setup')`,
      [user!.id, roles.get('main_admin'), school!.id],
    );
    await client.query(
      'SELECT seed_institution_masters($1), seed_library_categories($1), seed_transport_masters($1), seed_academic_profile_masters($1)',
      [school!.id],
    );
    await client.query('COMMIT');
    console.log('Created the school and its first owner account.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
