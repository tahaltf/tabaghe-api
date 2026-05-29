import { createPrivateKey } from 'crypto';

export type VapidKeySet = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

/** کلید خصوصی VAPID: base64url (خروجی web-push) یا PEM PKCS#8 */
export function normalizeVapidPrivateKey(raw: string): string {
  const trimmed = raw.trim().replace(/\\n/g, '\n');
  if (
    trimmed.includes('BEGIN PRIVATE KEY') ||
    trimmed.includes('BEGIN EC PRIVATE KEY')
  ) {
    const key = createPrivateKey(trimmed);
    const jwk = key.export({ format: 'jwk' }) as { d?: string };
    if (!jwk.d) {
      throw new Error('Invalid VAPID PEM private key');
    }
    return jwk.d;
  }
  return trimmed.replace(/=+$/, '');
}

export function resolveVapidKeys(): VapidKeySet | null {
  const publicKey = (process.env.WEB_PUSH_VAPID_PUBLIC_KEY || '').trim();
  const privateRaw = (process.env.WEB_PUSH_VAPID_PRIVATE_KEY || '').trim();
  const subject =
    (process.env.WEB_PUSH_VAPID_SUBJECT || '').trim() ||
    'mailto:support@tabagheh.com';

  if (!publicKey || !privateRaw) return null;

  try {
    const privateKey = normalizeVapidPrivateKey(privateRaw);
    return { publicKey, privateKey, subject };
  } catch {
    return null;
  }
}

export function isVapidConfigured(): boolean {
  return resolveVapidKeys() !== null;
}
