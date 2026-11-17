import 'dotenv/config';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Fastify from 'fastify';

type Trial = { name: string; id: string; expiresAt: string };
const validId = /^[a-z][a-z0-9_]{1,39}$/;
const ownerPassword = process.env.TRIAL_CONSOLE_PASSWORD;
if (!ownerPassword || ownerPassword.length < 20) throw new Error('Set a unique TRIAL_CONSOLE_PASSWORD of at least 20 characters');
const port = Number(process.env.TRIAL_CONSOLE_PORT ?? 4180);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid trial console port');
const host = `127.0.0.1:${port}`;
const origin = `http://${host}`;
const directory = resolve(process.env.TRIAL_CONSOLE_DIRECTORY ?? '.private-trials');
mkdirSync(directory, { recursive: true, mode: 0o700 });

const digest = (value: string) => createHash('sha256').update(value).digest();
const expectedAuth = digest(`Basic ${Buffer.from(`owner:${ownerPassword}`).toString('base64')}`);
const app = Fastify({ bodyLimit: 2048 });
app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
  done(null, new URLSearchParams(String(body)));
});
app.addHook('onRequest', async (request, reply) => {
  reply.header('Cache-Control', 'no-store');
  reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  if (request.headers.host !== host) return reply.code(403).send('Forbidden');
  if (!timingSafeEqual(digest(request.headers.authorization ?? ''), expectedAuth)) {
    return reply.header('WWW-Authenticate', 'Basic realm="ERP Trial Console"').code(401).send('Owner sign-in required');
  }
  if (request.method === 'POST' && request.headers.origin !== origin) return reply.code(403).send('Forbidden');
});

const fileFor = (id: string) => join(directory, `${id}.json`);
const readTrial = (id: string): Trial => JSON.parse(readFileSync(fileFor(id), 'utf8')) as Trial;
const encodeTrial = (trial: Trial) => JSON.stringify(trial, null, 2) + '\n';
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]!);
const displayDate = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

function addMonths(timestamp: number, months: number): string {
  const indiaOffset = 330 * 60_000;
  const date = new Date(timestamp + indiaOffset);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return new Date(date.getTime() - indiaOffset).toISOString();
}

app.get('/', async (_request, reply) => {
  const now = Date.now();
  const rows = readdirSync(directory).filter((file) => file.endsWith('.json') && validId.test(file.slice(0, -5)))
    .map((file) => readTrial(file.slice(0, -5))).map((trial) => {
      const id = escapeHtml(trial.id);
      const expiry = new Date(trial.expiresAt);
      return `<tr><td>${escapeHtml(trial.name)}<br><small>${id}.json</small></td><td>${displayDate.format(expiry)} IST<br>${expiry.getTime() <= now ? 'Expired' : 'Within trial period'}</td><td><form action="/extend" method="post"><input type="hidden" name="id" value="${id}"><select name="months" aria-label="Extension for ${escapeHtml(trial.name)}"><option value="1">1 month</option><option value="2">2 months</option><option value="4">4 months</option></select> <button>Extend</button></form></td></tr>`;
    }).join('');
  return reply.type('text/html; charset=utf-8').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ERP Trial Console</title><style>
  body{font:16px system-ui;max-width:60rem;margin:3rem auto;padding:0 1rem;color:#182944} form{margin:.75rem 0} label{display:inline-block;margin:.25rem .6rem .25rem 0} input,select,button{font:inherit;padding:.45rem} button{color:white;background:#087f83;border:0;border-radius:.3rem} table{border-collapse:collapse;width:100%;margin-top:1rem} td,th{padding:.6rem;text-align:left;border-bottom:1px solid #d7dfea} small{color:#455976}
  </style><h1>ERP Trial Console</h1><p>Owner only. Create a one-month trial when its environment is ready to hand over. Each file controls one separately provisioned ERP instance.</p>
  <form action="/create" method="post"><label>School or staff pilot <input name="name" required maxlength="120"></label><label>Trial ID <input name="id" required pattern="[a-z][a-z0-9_]{1,39}" maxlength="40" placeholder="staff"></label><button>Create one-month trial</button></form>
  <table><thead><tr><th>Pilot</th><th>Expiry</th><th>Extend</th></tr></thead><tbody>${rows || '<tr><td colspan="3">No trials recorded.</td></tr>'}</tbody></table></html>`);
});

app.post<{ Body: URLSearchParams }>('/create', async (request, reply) => {
  const id = request.body?.get('id') ?? '';
  const name = request.body?.get('name')?.trim() ?? '';
  if (!validId.test(id) || !name || name.length > 120) return reply.code(400).send('Enter a valid trial ID and school name');
  try {
    writeFileSync(fileFor(id), encodeTrial({ id, name, expiresAt: addMonths(Date.now(), 1) }), { flag: 'wx', mode: 0o640 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return reply.code(409).send('Trial ID already exists');
    throw error;
  }
  return reply.code(303).redirect('/');
});

app.post<{ Body: URLSearchParams }>('/extend', async (request, reply) => {
  const id = request.body?.get('id') ?? '';
  const months = request.body?.get('months') ?? '';
  if (!validId.test(id) || !['1', '2', '4'].includes(months)) return reply.code(400).send('Invalid trial or extension');
  let trial: Trial;
  try {
    trial = readTrial(id);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return reply.code(404).send('Trial does not exist');
    throw error;
  }
  trial.expiresAt = addMonths(Math.max(Date.now(), Date.parse(trial.expiresAt)), Number(months));
  const temporary = `${fileFor(id)}.${randomUUID()}.tmp`;
  writeFileSync(temporary, encodeTrial(trial), { flag: 'wx', mode: 0o640 });
  try {
    renameSync(temporary, fileFor(id));
  } catch (error) {
    unlinkSync(temporary);
    throw error;
  }
  return reply.code(303).redirect('/');
});

await app.listen({ host: '127.0.0.1', port });
console.log(`ERP Trial Console listening locally at ${origin}`);
