import { createHash, timingSafeEqual } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

const webRoot = fileURLToPath(new URL('../../../web/dist/', import.meta.url));
const importTemplateFiles = new Set([
  'digi-school-students-import.csv',
  'digi-school-admission-template.csv',
  'digi-school-admission-template.xlsx',
  'vendors-import.csv',
  'library-books-import.csv',
  'holiday-calendar-import.csv',
  'transport-allocations-import.csv',
  'academic-years-import.csv',
  'classes-import.csv',
  'sections-import.csv',
  'subjects-import.csv',
  'subject-offerings-import.csv',
  'staff-import.csv',
  'rooms-import.csv',
  'timetable-periods-import.csv',
  'fee-heads-import.csv',
  'institution-masters-import.csv',
]);

export async function registerManagedWeb(app: FastifyInstance, trialPassword?: string): Promise<void> {
  await access(join(webRoot, 'index.html'));

  app.get<{ Params: { filename: string } }>(
    '/api/import-templates/:filename',
    async (request, reply) => {
      const { filename } = request.params;
      if (!importTemplateFiles.has(filename)) {
        return reply.code(404).send({ error: { code: 'not_found', message: 'Import template not found' } });
      }
      const isExcel = filename.endsWith('.xlsx');
      const content = await readFile(join(webRoot, 'assets', filename));
      return reply
        .type(isExcel
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .header('Cache-Control', 'no-store')
        .send(content);
    },
  );

  if (trialPassword !== undefined) {
    const hash = (value: string) => createHash('sha256').update(value).digest();
    const expected = hash(`Basic ${Buffer.from(`staff:${trialPassword}`).toString('base64')}`);

    app.addHook('onRequest', async (request, reply) => {
      if (request.method === 'GET' && request.url === '/api/health') return;
      if (timingSafeEqual(hash(request.headers.authorization ?? ''), expected)) return;
      return reply.code(401)
        .header('WWW-Authenticate', 'Basic realm="DIGI Staff Pilot"')
        .header('Cache-Control', 'no-store')
        .send('Staff pilot access is required.');
    });
  }

  await app.register(fastifyStatic, {
    root: join(webRoot, 'assets'),
    prefix: '/assets/',
    index: false,
    maxAge: '1y',
    immutable: true,
  });
}

export function isManagedWebNavigation(method: string, url: string, accept: string | undefined): boolean {
  const path = url.split('?', 1)[0];
  return (method === 'GET' || method === 'HEAD') && !!accept?.includes('text/html') &&
    path !== '/api' && !path.startsWith('/api/') && !path.startsWith('/assets/') && !path.includes('.');
}

export const managedWebRoot = webRoot;
