import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const expiresAt = '2030-02-09T10:00:00.000Z';
let app: FastifyInstance;

beforeAll(async () => {
  vi.stubEnv('TRIAL_EXPIRES_AT', expiresAt);
  const { buildApp } = await import('../src/app');
  app = await buildApp();
});

afterAll(async () => {
  await app?.close();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it('blocks sign-in and existing sessions at the configured expiry', async () => {
  vi.setSystemTime(new Date(Date.parse(expiresAt) - 1));
  const before = await app.inject({ method: 'GET', url: '/api/auth/me' });
  expect(before.statusCode).toBe(401);

  vi.setSystemTime(new Date(expiresAt));
  for (const request of [
    { method: 'POST' as const, url: '/api/auth/login' },
    { method: 'GET' as const, url: '/api/auth/me', cookies: { erp_session: 'previous-session' } },
  ]) {
    const response = await app.inject(request);
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('trial_expired');
  }
});
