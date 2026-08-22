import { UserStatus } from '@prisma/client';
import {
  formatShabaDisplay,
  hasBasicListingProfile,
  hasMinimumFinancialFields,
  isFinancialVerified,
  isIdentityVerified,
} from './kyc-profile.util';

describe('kyc-profile.util', () => {
  it('requires first/last/national for listing profile', () => {
    expect(
      hasBasicListingProfile({
        firstName: 'علی',
        lastName: 'محمدی',
        nationalCode: '0013542419',
      }),
    ).toBe(true);
    expect(
      hasBasicListingProfile({
        firstName: 'علی',
        lastName: 'محمدی',
        nationalCode: '123',
      }),
    ).toBe(false);
  });

  it('requires card number for financial account input', () => {
    expect(hasMinimumFinancialFields('6037991234567890')).toBe(true);
    expect(hasMinimumFinancialFields('123')).toBe(false);
    expect(hasMinimumFinancialFields(null)).toBe(false);
  });

  it('formats shaba for display', () => {
    expect(formatShabaDisplay('123456789012345678901234')).toBe(
      'IR12 3456 7890 1234 5678 9012 34',
    );
  });

  it('treats financial KYC as identity + at least shaba or bank card', () => {
    const base = {
      status: UserStatus.APPROVED,
      isVerified: true,
      shabaNumber: '123456789012345678901234',
      bankCardNumber: '6037991234567890',
    };
    expect(isIdentityVerified(base)).toBe(true);
    expect(isFinancialVerified(base)).toBe(true);
    expect(isFinancialVerified({ ...base, bankCardNumber: null })).toBe(true);
    expect(isFinancialVerified({ ...base, shabaNumber: null })).toBe(true);
    expect(
      isFinancialVerified({ ...base, bankCardNumber: null, shabaNumber: null }),
    ).toBe(false);
  });
});
