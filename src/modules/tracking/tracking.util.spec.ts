import {
  abSplitCookieName,
  buildAbSetCookie,
  buildRedirectUrl,
  normalizeCampaignTargetUrl,
  parseAbCookie,
  pickSplitVariant,
  type SplitVariant,
} from './tracking.util';

describe('pickSplitVariant', () => {
  const variants: SplitVariant[] = [
    { id: 'a', targetUrl: '/seller', splitWeight: 50 },
    { id: 'b', targetUrl: '/seller?ab=v2', splitWeight: 50 },
  ];

  it('returns sticky variant when valid', () => {
    expect(pickSplitVariant(variants, 'b').id).toBe('b');
  });

  it('falls back when sticky id missing from group', () => {
    const picked = pickSplitVariant(variants, 'missing');
    expect(['a', 'b']).toContain(picked.id);
  });
});

describe('ab cookies', () => {
  const prev = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = prev;
  });

  it('builds and parses cookie', () => {
    process.env.NODE_ENV = 'development';
    const name = abSplitCookieName('seller-landing-ab');
    const header = `${name}=link-123; other=x`;
    expect(parseAbCookie(header, 'seller-landing-ab')).toBe('link-123');
    expect(buildAbSetCookie('seller-landing-ab', 'link-123')).toContain(name);
  });

  it('adds Secure in production', () => {
    process.env.NODE_ENV = 'production';
    expect(buildAbSetCookie('g', 'id')).toContain('Secure');
  });
});

describe('buildRedirectUrl / normalizeCampaignTargetUrl', () => {
  const frontend = 'https://tabagheh.com';

  it('allows same-site absolute and relative targets', () => {
    expect(normalizeCampaignTargetUrl('/seller', frontend)).toBe('/seller');
    expect(
      normalizeCampaignTargetUrl('https://tabagheh.com/seller', frontend),
    ).toContain('tabagheh.com');
  });

  it('rejects external absolute campaign targets', () => {
    expect(() =>
      normalizeCampaignTargetUrl('https://evil.com/phish', frontend),
    ).toThrow();
  });

  it('falls back away from external absolute redirects at click time', () => {
    const url = buildRedirectUrl(
      'https://evil.com/phish',
      {},
      frontend,
    );
    expect(url.startsWith('https://tabagheh.com')).toBe(true);
    expect(url).not.toContain('evil.com');
  });
});
