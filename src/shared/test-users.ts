import { UserRole } from '@prisma/client';

export const TEST_OTP_CODE = '11111';
export const TEST_ADMIN_PASSWORD = '@Ab123456789@';

export interface TestUserSeed {
  phone: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  nationalCode: string;
  shabaNumber: string;
  /** نقش در سناریوهای تست — خریدار/فروشنده فقط در جریان معامله تعیین می‌شود */
  label: 'seller' | 'buyer' | 'admin';
}

export const TEST_USER_SEEDS: TestUserSeed[] = [
  {
    phone: '09190000001',
    role: UserRole.USER,
    firstName: 'تست',
    lastName: 'فروشنده',
    nationalCode: '0499370899',
    shabaNumber: 'IR120170000000100000001001',
    label: 'seller',
  },
  {
    phone: '09190000002',
    role: UserRole.USER,
    firstName: 'تست',
    lastName: 'خریدار',
    nationalCode: '0499370900',
    shabaNumber: 'IR120170000000100000001002',
    label: 'buyer',
  },
  {
    phone: '09190000003',
    role: UserRole.ADMIN,
    firstName: 'تست',
    lastName: 'ادمین',
    nationalCode: '0499370901',
    shabaNumber: 'IR120170000000100000001003',
    label: 'admin',
  },
];

/** شماره GODADMIN که در بوت‌استرپ ساخته می‌شود */
export const GODADMIN_PHONE = '09190949469';

export const ALL_TEST_OTP_PHONES = [
  GODADMIN_PHONE,
  ...TEST_USER_SEEDS.map((u) => u.phone),
] as const;

export function isTestOtpPhone(phone: string): boolean {
  return (ALL_TEST_OTP_PHONES as readonly string[]).includes(phone);
}
