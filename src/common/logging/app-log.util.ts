import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';

const LOG_DIR = join(process.cwd(), 'logs');

function ensureDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

export function appendJsonLog(
  fileName: string,
  payload: Record<string, unknown>,
): void {
  try {
    ensureDir();
    const line = `${JSON.stringify(payload)}\n`;
    appendFileSync(join(LOG_DIR, fileName), line, { encoding: 'utf8' });
  } catch {
    // logging must never break request flow
  }
}

export function readRecentJsonLogs(
  fileName: string,
  limit = 200,
): Record<string, unknown>[] {
  try {
    const fullPath = join(LOG_DIR, fileName);
    if (!existsSync(fullPath)) return [];
    const lines = readFileSync(fullPath, 'utf8')
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);
    return lines
      .slice(-Math.max(1, limit))
      .reverse()
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return { raw: line };
        }
      });
  } catch {
    return [];
  }
}
