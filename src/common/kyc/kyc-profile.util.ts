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

/** احراز مالی برای برداشت: تایید هویت + شبا + تصویر کارت ملی */
export function isFinancialVerified(user: KycFinancialShape): boolean {
  return (
    isIdentityVerified(user) &&
    normalizeShabaDigits(user.shabaNumber).length === 24 &&
    Boolean(String(user.nationalCardImage ?? '').trim())
  );
}
