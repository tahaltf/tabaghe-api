function normalizeCorsOrigin(origin: string): string | null {
  const trimmed = origin.trim();
  if (!trimmed) return null;

  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

function getTabaghehFrontendOrigins(frontendAppUrl: string): string[] {
  const frontendOrigin = normalizeCorsOrigin(frontendAppUrl);
  const isProduction = process.env.NODE_ENV === 'production';

  const origins: Array<string | null> = [frontendOrigin];

  if (!isProduction) {
    origins.push('http://localhost:4200');
  }

  if (frontendOrigin === 'https://tabagheh.com') {
    origins.push('https://www.tabagheh.com');
  } else if (frontendOrigin === 'https://www.tabagheh.com') {
    origins.push('https://tabagheh.com');
  }

  return origins.filter((origin): origin is string => Boolean(origin));
}

/** Shared CORS allowlist for HTTP and WebSocket gateways. */
export function buildCorsOrigins(frontendAppUrl?: string): string[] {
  const baseUrl = (
    frontendAppUrl ??
    process.env.FRONTEND_APP_URL ??
    'https://tabagheh.com'
  ).trim();

  const configuredOrigins = (process.env.FRONTEND_ORIGINS || '')
    .split(',')
    .map(normalizeCorsOrigin)
    .filter((origin): origin is string => Boolean(origin));

  return [
    ...new Set([
      ...configuredOrigins,
      ...getTabaghehFrontendOrigins(baseUrl),
    ]),
  ];
}

export function websocketCorsOptions() {
  const origins = buildCorsOrigins();
  return {
    origin: origins.length ? origins : ['http://localhost:4200'],
    credentials: true,
  };
}
