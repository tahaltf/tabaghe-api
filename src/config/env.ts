export function validateEnv() {
    const required = [
        'DATABASE_URL',

        'JWT_ACCESS_SECRET',
        'JWT_REFRESH_SECRET',

        'JWT_ACCESS_TTL_SECONDS',
        'JWT_REFRESH_TTL_SECONDS',
    ];

    const missing = required.filter(
        (k) => !process.env[k] || process.env[k]!.trim() === '',
    );

    if (missing.length) {
        throw new Error(`Missing required env vars: ${missing.join(', ')}`);
    }
}
