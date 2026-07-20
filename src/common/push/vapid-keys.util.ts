import { createECDH, createPrivateKey } from 'crypto';

export type VapidKeySet = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

type VapidEnvSource = Record<string, string | undefined> | undefined;

function readPushEnv(key: string, source?: VapidEnvSource): string {
  return (source?.[key] ?? process.env[key] ?? '').trim();
}

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

/** public key متناظر با private — برای اعتبارسنجی جفت کلید */
export function deriveVapidPublicKeyFromPrivate(privateKeyBase64Url: string): string {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(privateKeyBase64Url, 'base64url'));
  let publicKey = ecdh.getPublicKey();
  if (publicKey.length < 65) {
    publicKey = Buffer.concat([
      Buffer.alloc(65 - publicKey.length),
      publicKey,
    ]);
  }
  return publicKey.toString('base64url');
}

export function resolveVapidKeys(source?: VapidEnvSource): VapidKeySet | null {
  const publicKey = readPushEnv('WEB_PUSH_VAPID_PUBLIC_KEY', source);
  const privateRaw = readPushEnv('WEB_PUSH_VAPID_PRIVATE_KEY', source);
  const subject =
    readPushEnv('WEB_PUSH_VAPID_SUBJECT', source) ||
    'mailto:support@tabagheh.com';

  if (!publicKey || !privateRaw) return null;

  try {
    const privateKey = normalizeVapidPrivateKey(privateRaw);
    return { publicKey, privateKey, subject };
  } catch {
    return null;
  }
}

export function isVapidConfigured(source?: VapidEnvSource): boolean {
  return resolveVapidKeys(source) !== null;
}

export function validateVapidKeyPair(source?: VapidEnvSource): {
  ok: boolean;
  error?: string;
  publicKey?: string;
} {
  const vapid = resolveVapidKeys(source);
  if (!vapid) return { ok: false, error: 'missing_env' };
  try {
    const derived = deriveVapidPublicKeyFromPrivate(vapid.privateKey);
    if (derived !== vapid.publicKey) {
      return {
        ok: false,
        error: 'public_private_mismatch',
        publicKey: derived,
      };
    }
    return { ok: true, publicKey: vapid.publicKey };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}
