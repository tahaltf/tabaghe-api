import { UserStatus } from '@prisma/client';

export type KycIdentityShape = {
  status: UserStatus;
  isVerified: boolean;
};

export type KycBasicProfileShape = {
  firstName?: string | null;
  lastName?: string | null;
  nationalCode?: string | null;
};

export type KycFinancialShape = KycIdentityShape & {
  shabaNumber?: string | null;
  bankCardNumber?: string | null;
  /** @deprecated legacy admin KYC — no longer required for financial verification */
  nationalCardImage?: string | null;
};

/** پروفایل پایه برای ثبت آگهی: نام، نام‌خانوادگی، کد ملی */
export function hasBasicListingProfile(user: KycBasicProfileShape): boolean {
  const firstName = String(user.firstName ?? '').trim();
  const lastName = String(user.lastName ?? '').trim();
  const nationalCode = String(user.nationalCode ?? '').trim();
  return (
    firstName.length >= 2 &&
    lastName.length >= 2 &&
    /^\d{10}$/.test(nationalCode)
  );
}

export function isIdentityVerified(user: KycIdentityShape): boolean {
  return user.status === UserStatus.APPROVED && user.isVerified === true;
}

export function normalizeShabaDigits(shabaNumber?: string | null): string {
  return String(shabaNumber ?? '')
    .trim()
    .replace(/^IR/i, '');
}

export function normalizeCardDigits(cardNumber?: string | null): string {
  return String(cardNumber ?? '').replace(/\D/g, '');
}

/** احراز مالی: تایید هویت + حداقل یکی از شبا یا کارت بانکی */
export function isFinancialVerified(user: KycFinancialShape): boolean {
  if (!isIdentityVerified(user)) return false;
  const hasShaba = normalizeShabaDigits(user.shabaNumber).length === 24;
  const hasCard = /^\d{16}$/.test(normalizeCardDigits(user.bankCardNumber));
  return hasShaba || hasCard;
}

/** حداقل شماره کارت ۱۶ رقمی برای ثبت حساب */
export function hasMinimumFinancialFields(
  cardNumber?: string | null,
  _shabaNumber?: string | null,
): boolean {
  return /^\d{16}$/.test(normalizeCardDigits(cardNumber));
}

export function formatShabaDisplay(shabaNumber?: string | null): string {
  const digits = normalizeShabaDigits(shabaNumber);
  if (digits.length !== 24) return '';
  return `IR${digits.slice(0, 2)} ${digits.slice(2, 6)} ${digits.slice(6, 10)} ${digits.slice(10, 14)} ${digits.slice(14, 18)} ${digits.slice(18, 22)} ${digits.slice(22)}`;
}

export function maskBankCardNumber(cardNumber?: string | null): string {
  const digits = normalizeCardDigits(cardNumber);
  if (digits.length !== 16) return '';
  return `${digits.slice(0, 4)}******${digits.slice(-4)}`;
}
