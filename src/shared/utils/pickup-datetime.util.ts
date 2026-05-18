/** Normalize admin/user pickup datetime strings to ISO (accepts datetime-local). */
export function normalizePickupIso(raw?: string | null): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;

  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();

  const localMatch = trimmed.match(
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/,
  );
  if (localMatch) {
    const [, date, hh, mm, ss] = localMatch;
    const parsed = new Date(`${date}T${hh}:${mm}:${ss ?? '00'}`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  return null;
}

export function normalizePickupSlotsInput(
  slots?: string[] | null,
  primary?: string | null,
): { time: string | null; slots: string[] } {
  const normalizedSlots = (slots ?? [])
    .map((s) => normalizePickupIso(s))
    .filter((x): x is string => !!x);
  const time = normalizePickupIso(primary) ?? normalizedSlots[0] ?? null;
  const unique = [...new Set([...(time ? [time] : []), ...normalizedSlots])];
  return { time, slots: unique };
}
