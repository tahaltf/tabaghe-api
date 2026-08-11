import { randomInt } from 'crypto';

/** Alphabet without ambiguous characters: O/0/I/1 */
const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_CODE_LENGTH = 8;

/** حداقل/حداکثر طول کد دعوت سفارشی (ادمین یا ورود دستی) */
export const INVITE_CODE_MIN_LENGTH = 3;
export const INVITE_CODE_MAX_LENGTH = 20;

export type InviteCodeValidation =
  | { ok: true; code: string }
  | { ok: false; error: string };

export function validateInviteCode(
  raw: string | null | undefined,
): InviteCodeValidation {
  const code = normalizeInviteCode(raw);
  if (!code) {
    return { ok: false, error: 'کد دعوت نمی‌تواند خالی باشد.' };
  }
  if (code.length < INVITE_CODE_MIN_LENGTH) {
    return {
      ok: false,
      error: `کد دعوت باید حداقل ${INVITE_CODE_MIN_LENGTH} کاراکتر باشد.`,
    };
  }
  if (code.length > INVITE_CODE_MAX_LENGTH) {
    return {
      ok: false,
      error: `کد دعوت حداکثر ${INVITE_CODE_MAX_LENGTH} کاراکتر مجاز است.`,
    };
  }
  return { ok: true, code };
}

export function generateInviteCode(length = INVITE_CODE_LENGTH): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

export function normalizeInviteCode(raw: string | null | undefined): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}
