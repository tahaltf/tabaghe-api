import { UserStatus } from '@prisma/client';
import {
  hasBasicListingProfile,
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

  it('treats financial KYC as identity + shaba + national card', () => {
    const base = {
      status: UserStatus.APPROVED,
      isVerified: true,
      shabaNumber: 'IR123456789012345678901234',
      nationalCardImage: 'card.jpg',
    };
    expect(isIdentityVerified(base)).toBe(true);
    expect(isFinancialVerified(base)).toBe(true);
    expect(isFinancialVerified({ ...base, nationalCardImage: null })).toBe(
      false,
    );
    expect(isFinancialVerified({ ...base, shabaNumber: null })).toBe(false);
  });
});
