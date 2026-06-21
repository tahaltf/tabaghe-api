const REQUIRED_PRODUCTION_ENV = [
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'SMS_IR_API_KEY',
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
] as const;

const PLACEHOLDER_VALUES = new Set([
  'replace-with-strong-secret',
  'replace-with-strong-refresh-secret',
  'replace-with-sms-ir-api-key',
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
}
