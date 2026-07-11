import {
  formatLegalUserName,
  formatUserDisplayName,
  formatUserInitials,
} from './user-display-name.util';

describe('user-display-name.util', () => {
  it('prefers displayName when set', () => {
    expect(
      formatUserDisplayName({
        displayName: 'علی طبقه',
        firstName: 'علی',
        lastName: 'احمدی',
        phone: '09120000000',
      }),
    ).toBe('علی طبقه');
  });

  it('falls back to legal name', () => {
    expect(
      formatUserDisplayName({
        firstName: 'علی',
        lastName: 'احمدی',
        phone: '09120000000',
      }),
    ).toBe('علی احمدی');
  });

  it('falls back to phone by default', () => {
    expect(formatUserDisplayName({ phone: '09120000000' })).toBe('09120000000');
  });

  it('supports guest fallback', () => {
    expect(formatUserDisplayName({}, { fallback: 'guest' })).toBe('');
  });

  it('formats legal name only', () => {
    expect(formatLegalUserName({ firstName: 'علی', lastName: 'احمدی' })).toBe(
      'علی احمدی',
    );
  });

  it('builds initials from first name only', () => {
    expect(
      formatUserInitials({ firstName: 'علی', lastName: 'احمدی' }),
    ).toBe('ع');
  });

  it('builds initials from displayName when firstName missing', () => {
    expect(
      formatUserInitials({ displayName: 'علی طبقه' }),
    ).toBe('ع');
  });
});
