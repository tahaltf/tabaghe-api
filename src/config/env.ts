import { parseRedisUrl } from '../infrastructure/cache/redis-options.util';

const REQUIRED_PRODUCTION_ENV = [
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'ACTIVE_SMS_PROVIDER',
  'API_URL',
  'FRONTEND_APP_URL',
  'PAYMENT_RETURN_URL',
  'FRONTEND_ORIGINS',
  'ACTIVE_PAYMENT_GATEWAY',
  'ZIBAL_MERCHANT',
  'ZIBAL_REQUEST_URL',
  'ZIBAL_VERIFY_URL',
  'ZIBAL_START_PAY_URL',
  'ZIBAL_CALLBACK_URL',
  'REDIS_URL',
] as const;

const PLACEHOLDER_VALUES = new Set([
  'replace-with-strong-secret',
  'replace-with-strong-refresh-secret',
  'replace-with-sms-ir-api-key',
  'replace-with-kavenegar-api-key',
  'your-merchant-id',
  'super-secret-access',
  'super-secret-refresh',
  'fallback_access_secret_key',
  'fallback_refresh_secret_key',
  'dev-only-access-secret-not-for-production',
  'dev-only-refresh-secret-not-for-production',
]);

function isPlaceholderEnvValue(key: string, value: string): boolean {
  const normalizedValue = value
    .trim()
    .replace(/^["']|["']$/g, '')
    .toLowerCase();

  if (PLACEHOLDER_VALUES.has(normalizedValue)) return true;
  if (normalizedValue.startsWith('replace-with-')) return true;
  if (normalizedValue.startsWith('your-')) return true;

  return (
    key === 'DATABASE_URL' && /user:(pass|password)@host/i.test(normalizedValue)
  );
}

export function validateProductionEnv() {
  const missing = REQUIRED_PRODUCTION_ENV.filter(
    (k) => !process.env[k] || process.env[k]!.trim() === '',
  );
  const placeholders = REQUIRED_PRODUCTION_ENV.filter((k) => {
    const value = process.env[k];
    return value ? isPlaceholderEnvValue(k, value) : false;
  });

  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }

  if (placeholders.length) {
    throw new Error(
      `Production env vars still contain placeholder values: ${placeholders.join(', ')}`,
    );
  }

  const smsProvider = (process.env.ACTIVE_SMS_PROVIDER ?? 'smsir')
    .trim()
    .toLowerCase();
  if (smsProvider === 'kavenegar') {
    const key = process.env.KAVENEGAR_API_KEY?.trim() ?? '';
    if (!key || isPlaceholderEnvValue('KAVENEGAR_API_KEY', key)) {
      throw new Error(
        'KAVENEGAR_API_KEY is required when ACTIVE_SMS_PROVIDER=kavenegar',
      );
    }
  } else {
    const key = process.env.SMS_IR_API_KEY?.trim() ?? '';
    if (!key || isPlaceholderEnvValue('SMS_IR_API_KEY', key)) {
      throw new Error(
        'SMS_IR_API_KEY is required when ACTIVE_SMS_PROVIDER=smsir',
      );
    }
  }

  validateRedisEnv({ requireInProduction: true });
}

/**
 * Validate REDIS_URL when set. In production, REDIS_URL is required
 * (shared throttler, Socket.io adapter, and TTL cache across replicas).
 */
export function validateRedisEnv(options?: {
  requireInProduction?: boolean;
}): string | null {
  const requireInProduction = options?.requireInProduction ?? false;
  const isProduction = process.env.NODE_ENV === 'production';
  const raw = process.env.REDIS_URL;

  if ((!raw || !raw.trim()) && requireInProduction && isProduction) {
    throw new Error(
      'REDIS_URL is required in production for shared cache, throttler, and websockets',
    );
  }

  return parseRedisUrl(raw);
}
