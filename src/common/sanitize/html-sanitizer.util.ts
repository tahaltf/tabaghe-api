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
  if (attr === 'href' && trimmed.startsWith('#')) return true;
  if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return true;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true;
  return false;
}

function sanitizeAttributes(tag: string, rawAttrs: string): string {
  const allowedForTag = TAG_ATTRS[tag] ?? new Set<string>();
  const parts: string[] = [];

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
    }

    parts.push(`${name}="${escapeHtml(value)}"`);
  }

  return parts.length ? ` ${parts.join(' ')}` : '';
}

/**
 * Strip dangerous HTML while preserving a safe subset for WordPress listing content.
 */
export function sanitizeRichHtml(html: string | null | undefined): string {
  const input = String(html ?? '').trim();
  if (!input) return '';

  return input.replace(
    /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g,
    (full, tagName: string, rawAttrs: string) => {
      const tag = tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) return '';
      if (full.startsWith('</')) return `</${tag}>`;
      return `<${tag}${sanitizeAttributes(tag, rawAttrs)}>`;
    },
  );
}
