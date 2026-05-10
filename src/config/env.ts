export function validateProductionEnv() {
  const required = [
    'DATABASE_URL',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'SMS_IR_API_KEY',
  ];

  const missing = required.filter(
    (k) => !process.env[k] || process.env[k]!.trim() === '',
  );

  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}
