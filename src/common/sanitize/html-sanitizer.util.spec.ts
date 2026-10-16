import {
  sanitizeListingDescription,
  sanitizeRichHtml,
  stripAllHtml,
} from './html-sanitizer.util';

describe('sanitizeRichHtml', () => {
  it('strips script tags and content', () => {
    const out = sanitizeRichHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).toContain('<p>hi</p>');
    expect(out.toLowerCase()).not.toContain('script');
    expect(out).not.toContain('alert');
  });

  it('removes event handler attributes', () => {
    const out = sanitizeRichHtml('<img src="/a.jpg" onerror="alert(1)">');
    expect(out).toContain('src=');
    expect(out.toLowerCase()).not.toContain('onerror');
  });

  it('blocks javascript: href', () => {
    const out = sanitizeRichHtml('<a href="javascript:alert(1)">x</a>');
    expect(out.toLowerCase()).not.toContain('javascript:');
  });

  it('forces rel=noopener noreferrer on links', () => {
    const out = sanitizeRichHtml('<a href="https://example.com" target="_blank">x</a>');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('rejects protocol-relative URLs', () => {
    const out = sanitizeRichHtml('<a href="//evil.com">x</a>');
    expect(out).not.toContain('evil.com');
  });
});

describe('stripAllHtml / sanitizeListingDescription', () => {
  it('strips all tags for plain listings', () => {
    expect(stripAllHtml('<b>bold</b><script>x</script>')).toBe('bold');
    expect(
      sanitizeListingDescription('<script>x</script>hello', false),
    ).toBe('hello');
  });

  it('keeps safe tags for rich listings', () => {
    const out = sanitizeListingDescription('<p>ok</p><script>bad</script>', true);
    expect(out).toContain('<p>ok</p>');
    expect(out).not.toContain('script');
  });
});
