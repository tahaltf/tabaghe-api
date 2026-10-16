const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'span',
  'div',
  'a',
  'img',
]);

const GLOBAL_ATTRS = new Set(['class', 'dir', 'lang', 'title']);
const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'target', 'rel']),
  img: new Set(['src', 'alt', 'width', 'height', 'loading']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan']),
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isSafeUrl(value: string, attr: 'href' | 'src'): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  // Block javascript:, data:, vbscript:, etc.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    if (attr === 'href' && /^(https?:|mailto:|tel:)/i.test(trimmed)) return true;
    if (attr === 'src' && /^https?:/i.test(trimmed)) return true;
    return false;
  }
  if (attr === 'href' && trimmed.startsWith('#')) return true;
  // Relative paths only; reject protocol-relative //evil.com
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true;
  return false;
}

function sanitizeAttributes(tag: string, rawAttrs: string): string {
  const allowedForTag = TAG_ATTRS[tag] ?? new Set<string>();
  const parts: string[] = [];
  let hasRel = false;
  let hasHref = false;

  const attrRegex =
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(rawAttrs)) !== null) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (name.startsWith('on')) continue;
    if (name === 'style') continue;
    if (!GLOBAL_ATTRS.has(name) && !allowedForTag.has(name)) continue;

    if (name === 'href' || name === 'src') {
      if (!isSafeUrl(value, name)) continue;
      if (name === 'href') hasHref = true;
    }

    if (name === 'rel') {
      hasRel = true;
      parts.push(`rel="noopener noreferrer"`);
      continue;
    }

    if (name === 'target') {
      const t = value.trim().toLowerCase();
      if (t !== '_blank' && t !== '_self') continue;
      parts.push(`target="${escapeHtml(t)}"`);
      continue;
    }

    parts.push(`${name}="${escapeHtml(value)}"`);
  }

  if (tag === 'a' && hasHref && !hasRel) {
    parts.push(`rel="noopener noreferrer"`);
  }

  return parts.length ? ` ${parts.join(' ')}` : '';
}

/**
 * Strip dangerous HTML while preserving a safe subset for WordPress listing content.
 */
export function sanitizeRichHtml(html: string | null | undefined): string {
  const input = String(html ?? '').trim();
  if (!input) return '';

  // Remove script/style blocks entirely (including content).
  const withoutBlocks = input
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');

  return withoutBlocks.replace(
    /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g,
    (full, tagName: string, rawAttrs: string) => {
      const tag = tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) return '';
      if (full.startsWith('</')) return `</${tag}>`;
      return `<${tag}${sanitizeAttributes(tag, rawAttrs)}>`;
    },
  );
}

/** Remove all HTML tags — for plain-text listing/chat fields. */
export function stripAllHtml(html: string | null | undefined): string {
  return String(html ?? '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<\/?[^>]+>/g, '');
}

/**
 * Listing description: rich HTML only when import/WP allows it; otherwise strip tags.
 */
export function sanitizeListingDescription(
  value: string | null | undefined,
  allowRichHtml: boolean,
): string {
  if (allowRichHtml) return sanitizeRichHtml(value);
  return stripAllHtml(value);
}

/** Recursively sanitize string values in JSON-like landing props. */
export function sanitizeJsonStrings(
  value: unknown,
  depth = 0,
): unknown {
  if (depth > 12) return value;
  if (typeof value === 'string') {
    // Landing UI uses text interpolation; strip tags to prevent stored XSS if later bound as HTML.
    return stripAllHtml(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonStrings(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeJsonStrings(v, depth + 1);
    }
    return out;
  }
  return value;
}
