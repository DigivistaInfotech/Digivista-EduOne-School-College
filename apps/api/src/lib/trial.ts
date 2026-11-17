import { readFile } from 'node:fs/promises';
import { AppError } from './errors';

export function parseTrialExpiry(value: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error('Trial expiry must be an ISO UTC timestamp including milliseconds');
  }
  return timestamp;
}

export async function readTrialExpiry(file: string): Promise<number> {
  try {
    const trial = JSON.parse(await readFile(file, 'utf8')) as { expiresAt: string };
    return parseTrialExpiry(trial.expiresAt);
  } catch {
    throw new AppError(503, 'trial_unavailable', 'Trial configuration is unavailable. Contact your trial coordinator.');
  }
}
