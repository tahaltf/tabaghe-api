/** نرمال‌سازی فیلد sections لندینگ از DB یا DTO — فقط بلوک‌های با type معتبر */
const VALID_SECTION_TYPES = new Set([
  'hero',
  'features',
  'steps',
  'cta',
  'register-form',
  'image-text',
  'stats',
  'spacer',
  'faq',
  'testimonials',
  'banner',
  'logos',
  'video',
]);

function unwrapSectionsRaw(raw: unknown): unknown[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      return unwrapSectionsRaw(JSON.parse(trimmed));
    } catch {
      return [];
    }
  }
  if (typeof raw === 'object') {
    const row = raw as Record<string, unknown>;
    if (Array.isArray(row['sections'])) return row['sections'];
    if (Array.isArray(row['blocks'])) return row['blocks'];
    if (Array.isArray(row['items'])) return row['items'];
  }
  return [];
}

function isValidSection(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false;
  const row = item as Record<string, unknown>;
  const type = String(row['type'] ?? row['blockType'] ?? '')
    .trim()
    .toLowerCase();
  return VALID_SECTION_TYPES.has(type);
}

export function coerceLandingSections(raw: unknown): unknown[] {
  return unwrapSectionsRaw(raw).filter(isValidSection);
}
