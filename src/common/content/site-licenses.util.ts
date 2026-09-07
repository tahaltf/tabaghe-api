/** Footer trust / license badges (Enamad + custom image+link). */

export type SiteLicenseKind = 'enamad' | 'image';

export type SiteLicenseItem = {
  id: string;
  kind: SiteLicenseKind;
  label: string;
  enabled: boolean;
  sortOrder: number;
  /** Enamad trustseal id */
  enamadId?: string;
  /** Enamad trustseal Code */
  enamadCode?: string;
  /** Uploaded brand filename for custom badge */
  imageFile?: string;
  /** External link for custom badge */
  href?: string;
  alt?: string;
};

export type PublicSiteLicense = {
  id: string;
  kind: SiteLicenseKind;
  label: string;
  enamadId?: string;
  enamadCode?: string;
  /** Public URL path or filename for custom icon */
  imageFile?: string;
  href?: string;
  alt?: string;
};

/** Extract Enamad id + Code from official embed HTML or URL. */
export function parseEnamadTag(raw: string): {
  enamadId: string;
  enamadCode: string;
} | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  const idMatch =
    text.match(/[?&]id=([^&"'>\s]+)/i) ||
    text.match(/\bid\s*=\s*["']?(\d+)["']?/i);
  const codeMatch =
    text.match(/[?&]Code=([^&"'>\s]+)/i) ||
    text.match(/\bcode\s*=\s*["']([^"']+)["']/i) ||
    text.match(/\bCode\s*=\s*["']([^"']+)["']/i);

  const enamadId = idMatch?.[1]?.trim() ?? '';
  const enamadCode = decodeURIComponent(codeMatch?.[1]?.trim() ?? '');
  if (!enamadId || !enamadCode) return null;
  return { enamadId, enamadCode };
}

export function parseSiteLicensesJson(
  raw: string | null | undefined,
): SiteLicenseItem[] {
  if (!raw?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const items: SiteLicenseItem[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < parsed.length; i++) {
    const row = parsed[i];
    if (!row || typeof row !== 'object') continue;
    const kindRaw = String((row as { kind?: unknown }).kind ?? '')
      .trim()
      .toLowerCase();
    if (kindRaw !== 'enamad' && kindRaw !== 'image') continue;

    const idRaw = String((row as { id?: unknown }).id ?? '').trim();
    const id = idRaw || `lic-${kindRaw}-${i}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const label =
      String((row as { label?: unknown }).label ?? '').trim() ||
      (kindRaw === 'enamad' ? 'اینماد' : 'مجوز');
    const enabled = (row as { enabled?: unknown }).enabled !== false;
    const sortRaw = Number((row as { sortOrder?: unknown }).sortOrder);
    const sortOrder = Number.isFinite(sortRaw) ? sortRaw : i;

    if (kindRaw === 'enamad') {
      const enamadId = String(
        (row as { enamadId?: unknown }).enamadId ?? '',
      ).trim();
      const enamadCode = String(
        (row as { enamadCode?: unknown }).enamadCode ?? '',
      ).trim();
      items.push({
        id,
        kind: 'enamad',
        label,
        enabled,
        sortOrder,
        enamadId,
        enamadCode,
      });
      continue;
    }

    const imageFile = String(
      (row as { imageFile?: unknown }).imageFile ?? '',
    ).trim();
    const href = String((row as { href?: unknown }).href ?? '').trim();
    const alt = String((row as { alt?: unknown }).alt ?? '').trim() || label;
    items.push({
      id,
      kind: 'image',
      label,
      enabled,
      sortOrder,
      imageFile,
      href,
      alt,
    });
  }

  items.sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
  );
  return items;
}

export function migrateEnamadToLicenses(opts: {
  licensesJson?: string | null;
  enamadId?: string | null;
  enamadCode?: string | null;
  enamadEnabled?: string | null;
}): SiteLicenseItem[] {
  const existing = parseSiteLicensesJson(opts.licensesJson);
  if (existing.length > 0) return existing;

  const enamadId = String(opts.enamadId ?? '').trim();
  const enamadCode = String(opts.enamadCode ?? '').trim();
  if (!enamadId || !enamadCode) return [];

  const enabled =
    opts.enamadEnabled == null || String(opts.enamadEnabled).trim() === ''
      ? true
      : String(opts.enamadEnabled).trim().toLowerCase() === 'true';

  return [
    {
      id: 'lic-enamad',
      kind: 'enamad',
      label: 'اینماد',
      enabled,
      sortOrder: 0,
      enamadId,
      enamadCode,
    },
  ];
}

export function toPublicLicenses(
  items: SiteLicenseItem[],
): PublicSiteLicense[] {
  return items
    .filter((x) => x.enabled)
    .filter((x) => {
      if (x.kind === 'enamad') {
        return Boolean(x.enamadId?.trim() && x.enamadCode?.trim());
      }
      return Boolean(x.imageFile?.trim() && x.href?.trim());
    })
    .map((x) => {
      if (x.kind === 'enamad') {
        return {
          id: x.id,
          kind: 'enamad' as const,
          label: x.label,
          enamadId: x.enamadId,
          enamadCode: x.enamadCode,
        };
      }
      return {
        id: x.id,
        kind: 'image' as const,
        label: x.label,
        imageFile: x.imageFile,
        href: x.href,
        alt: x.alt || x.label,
      };
    });
}

export function validateSiteLicensesJson(raw: string): void {
  if (!raw.trim()) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('SITE_LICENSES_JSON نامعتبر است');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('SITE_LICENSES_JSON باید آرایه باشد');
  }
  const seen = new Set<string>();
  for (const row of parsed) {
    if (!row || typeof row !== 'object') {
      throw new Error('هر مجوز باید آبجکت باشد');
    }
    const kind = String((row as { kind?: unknown }).kind ?? '')
      .trim()
      .toLowerCase();
    if (kind !== 'enamad' && kind !== 'image') {
      throw new Error(`نوع مجوز پشتیبانی نمی‌شود: ${kind || '(خالی)'}`);
    }
    const id = String((row as { id?: unknown }).id ?? '').trim();
    if (id) {
      if (seen.has(id)) throw new Error(`شناسه مجوز تکراری: ${id}`);
      seen.add(id);
    }
    if (kind === 'enamad') {
      const enabled = (row as { enabled?: unknown }).enabled !== false;
      const enamadId = String(
        (row as { enamadId?: unknown }).enamadId ?? '',
      ).trim();
      const enamadCode = String(
        (row as { enamadCode?: unknown }).enamadCode ?? '',
      ).trim();
      if (enabled && (!enamadId || !enamadCode)) {
        throw new Error('برای اینماد فعال، شناسه و کد الزامی است');
      }
    }
    if (kind === 'image') {
      const enabled = (row as { enabled?: unknown }).enabled !== false;
      const imageFile = String(
        (row as { imageFile?: unknown }).imageFile ?? '',
      ).trim();
      const href = String((row as { href?: unknown }).href ?? '').trim();
      if (enabled && !imageFile) {
        throw new Error('برای مجوز تصویری فعال، فایل آیکن الزامی است');
      }
      if (enabled && !href) {
        throw new Error('برای مجوز تصویری فعال، لینک الزامی است');
      }
      if (href && !/^https?:\/\//i.test(href) && !href.startsWith('/')) {
        throw new Error('لینک مجوز باید با http(s) یا / شروع شود');
      }
    }
  }
}

export function serializeSiteLicensesJson(items: SiteLicenseItem[]): string {
  return JSON.stringify(items);
}
