import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { DATABASE_URL, databaseUrlParts, needsInitialise, PG_DATA_DIR } from './config';

export interface EmbeddedHandle {
  instance: EmbeddedPostgres;
  stop: () => Promise<void>;
}

/**
 * Starts a real PostgreSQL server (not an emulator) without Docker. Used only
 * for local development and tests; production points DATABASE_URL at a managed
 * PostgreSQL instance and never loads this module.
 */
export async function startEmbeddedPostgres(options?: {
  dataDir?: string;
  persistent?: boolean;
  port?: number;
  log?: boolean;
}): Promise<EmbeddedHandle> {
  const dataDir = options?.dataDir ?? PG_DATA_DIR;
  const parts = databaseUrlParts();
  const port = options?.port ?? parts.port;
  const log = options?.log ?? true;

  const instance = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: parts.user,
    password: parts.password,
    port,
    persistent: options?.persistent ?? true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: log ? (message) => console.log(`[postgres] ${message.trim()}`) : () => {},
    onError: (error) => {
      const text = error instanceof Error ? error.message : String(error);
      // Expected noise while the embedded server shuts down.
      if (/ECONNRESET|Connection terminated/i.test(text)) return;
      if (log) console.error('[postgres]', text);
    },
  });

  if (needsInitialise(dataDir)) {
    await instance.initialise();
  }
  await instance.start();

  return {
    instance,
    stop: async () => {
      try {
        await instance.stop();
      } catch (err: unknown) {
        const text = err instanceof Error ? err.message : String(err);
        if (/EBUSY|resource busy or locked/i.test(text)) {
          // Windows requires a moment for postgres file handles to be released before temp folder deletion
          await new Promise((resolve) => setTimeout(resolve, 600));
          try {
            await instance.stop();
          } catch {
            // Temp directory will be cleaned up by OS or subsequent run
          }
        } else {
          throw err;
        }
      }
    },
  };
}

/** Creates the application database when it does not exist yet. */
export async function ensureDatabase(instance: EmbeddedPostgres, database: string): Promise<void> {
  try {
    await instance.createDatabase(database);
  } catch (error) {
    const code = (error as { code?: string }).code;
    // 42P04 = duplicate_database. Any other error is real.
    if (code !== '42P04') throw error;
  }
}

export async function pingDatabase(url: string = DATABASE_URL): Promise<boolean> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Waits for the server socket to accept connections after `start()`. */
export async function waitForDatabase(url: string = DATABASE_URL, attempts = 40): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await pingDatabase(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Database at ${redactUrl(url)} did not become ready`);
}

export function redactUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.password) parsed.password = '***';
  return parsed.toString();
}
