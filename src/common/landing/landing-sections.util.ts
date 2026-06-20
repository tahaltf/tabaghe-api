/** نرمال‌سازی فیلد sections لندینگ از DB یا DTO */
export function coerceLandingSections(raw: unknown): unknown[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      return coerceLandingSections(JSON.parse(trimmed));
    } catch {
      return [];
    }
  }
  if (typeof raw === 'object') {
    const row = raw as Record<string, unknown>;
    if (Array.isArray(row['sections'])) return row['sections'];
    if (Array.isArray(row['blocks'])) return row['blocks'];
  }
  return [];
}
