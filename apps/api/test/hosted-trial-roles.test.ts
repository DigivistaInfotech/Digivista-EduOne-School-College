import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import { ROLES } from '@erp/shared';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance | undefined;
let stop: (() => Promise<void>) | undefined;
let closePool: (() => Promise<void>) | undefined;
let directory: string | undefined;

afterAll(async () => {
  await app?.close();
  await closePool?.();
  await stop?.();
  if (directory) await rm(directory, { recursive: true });
  vi.unstubAllEnvs();
});

it('gives every existing role an independent sign-in and reserves trial administration for the owner', async () => {
  const { startTestDatabase } = await import('@erp/db/test-database');
  const database = await startTestDatabase({ database: 'erp_trial_test', seed: false });
  stop = database.stop;
  directory = await mkdtemp(join(tmpdir(), 'erp-trial-expiry-'));
  const trialFile = join(directory, 'test.json');
  await writeFile(trialFile, JSON.stringify({ expiresAt: '2030-02-09T10:00:00.000Z' }));
  vi.stubEnv('DATABASE_URL', database.url);
  vi.stubEnv('TRIAL_EXPIRY_FILE', trialFile);
  vi.stubEnv('TRIAL_EXPIRES_AT', undefined);

  const { buildApp } = await import('../src/app');
  const databaseModule = await import('../src/db');
  closePool = databaseModule.closePool;
  const { seedHostedTrial } = await import('../../../packages/db/src/demo-seed');
  const client = await databaseModule.getPool().connect();
  let credentials: Awaited<ReturnType<typeof seedHostedTrial>>;
  try {
    credentials = await seedHostedTrial(client);
    await expect(seedHostedTrial(client)).rejects.toThrow('requires an empty database');
  } finally {
    client.release();
  }
  expect(new Set(credentials.map(({ password }) => password)).size).toBe(credentials.length);
  expect(new Set(credentials.flatMap(({ roles }) => roles))).toEqual(new Set(ROLES.map(({ code }) => code)));

  app = await buildApp();
  const sessions = new Map<string, { cookie: string; schoolId: string }>();
  for (const { email, password, roles } of credentials) {
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
    expect(login.statusCode, roles.join(', ')).toBe(200);
    const [membership] = login.json().memberships;
    expect(membership.roles).toEqual(roles);
    expect(membership.permissions.includes('access.roles.manage')).toBe(roles.includes('main_admin'));
    sessions.set(roles[0]!, { cookie: String(login.headers['set-cookie']).split(';')[0]!, schoolId: membership.schoolId });
  }

  const admin = sessions.get('school_admin')!;
  const owner = sessions.get('main_admin')!;
  const createAccount = { email: 'new@demo.test', displayName: 'Demo Tester', password: 'Test-fixture-password-784', scopeType: 'school' };
  for (const [session, roleCode] of [[admin, 'school_admin'], [owner, 'main_admin']] as const) {
    const forbidden = await app.inject({
      method: 'POST', url: `/api/schools/${session.schoolId}/users`,
      headers: { cookie: session.cookie }, payload: { ...createAccount, roleCode },
    });
    expect(forbidden.statusCode).toBe(403);
  }

  const sessionRequest = { method: 'GET' as const, url: '/api/auth/me', headers: { cookie: admin.cookie } };
  await writeFile(trialFile, JSON.stringify({ expiresAt: '2020-02-09T10:00:00.000Z' }));
  expect((await app.inject(sessionRequest)).json().error.code).toBe('trial_expired');
  await writeFile(trialFile, JSON.stringify({ expiresAt: '2030-02-09T10:00:00.000Z' }));
  expect((await app.inject(sessionRequest)).statusCode).toBe(200);
  await rm(trialFile);
  expect((await app.inject(sessionRequest)).statusCode).toBe(503);
}, 300_000);
