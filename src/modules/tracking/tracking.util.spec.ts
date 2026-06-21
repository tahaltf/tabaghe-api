import {
  abSplitCookieName,
  buildAbSetCookie,
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
  it('builds and parses cookie', () => {
    const name = abSplitCookieName('seller-landing-ab');
    const header = `${name}=link-123; other=x`;
    expect(parseAbCookie(header, 'seller-landing-ab')).toBe('link-123');
    expect(buildAbSetCookie('seller-landing-ab', 'link-123')).toContain(name);
  });
});
