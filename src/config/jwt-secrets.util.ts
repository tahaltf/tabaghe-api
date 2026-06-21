import { ConfigService } from '@nestjs/config';

const DEV_ACCESS_FALLBACK = 'dev-only-access-secret-not-for-production';
const DEV_REFRESH_FALLBACK = 'dev-only-refresh-secret-not-for-production';

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function resolveJwtAccessSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET')?.trim();
  if (secret) return secret;
  if (isProduction()) {
    throw new Error('JWT_SECRET is required in production');
  }
  return DEV_ACCESS_FALLBACK;
}

export function resolveJwtRefreshSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_REFRESH_SECRET')?.trim();
  if (secret) return secret;
  if (isProduction()) {
    throw new Error('JWT_REFRESH_SECRET is required in production');
  }
  return DEV_REFRESH_FALLBACK;
}
