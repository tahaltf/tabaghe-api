export const TICKET_ATTACHMENT_SETTING_KEYS = {
  MIME_TYPES: 'TICKET_ATTACHMENT_ALLOWED_MIME_TYPES',
  MAX_SIZE_MB: 'TICKET_ATTACHMENT_MAX_SIZE_MB',
} as const;

export const DEFAULT_TICKET_ATTACHMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export const DEFAULT_TICKET_ATTACHMENT_MAX_SIZE_MB = 5;

export const KNOWN_TICKET_ATTACHMENT_FORMATS = [
  { id: 'jpeg', mime: 'image/jpeg', label: 'JPEG', accept: 'image/jpeg,.jpg,.jpeg' },
  { id: 'png', mime: 'image/png', label: 'PNG', accept: 'image/png,.png' },
  { id: 'webp', mime: 'image/webp', label: 'WebP', accept: 'image/webp,.webp' },
  { id: 'pdf', mime: 'application/pdf', label: 'PDF', accept: 'application/pdf,.pdf' },
] as const;

export type TicketMessageAttachment = {
  path: string;
  originalName: string;
  mimeType: string;
  size: number;
};

const KNOWN_MIME_SET = new Set<string>(
  KNOWN_TICKET_ATTACHMENT_FORMATS.map((f) => f.mime),
);

export function parseTicketAttachmentMimeTypes(
  raw?: string | null,
): string[] {
  if (!raw?.trim()) {
    return [...DEFAULT_TICKET_ATTACHMENT_MIME_TYPES];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [...DEFAULT_TICKET_ATTACHMENT_MIME_TYPES];
    }
    const mimes = parsed
      .map((x) => String(x ?? '').trim().toLowerCase())
      .filter((mime) => KNOWN_MIME_SET.has(mime));
    return mimes.length > 0 ? mimes : [...DEFAULT_TICKET_ATTACHMENT_MIME_TYPES];
  } catch {
    return [...DEFAULT_TICKET_ATTACHMENT_MIME_TYPES];
  }
}

export function parseTicketAttachmentMaxSizeMb(raw?: string | null): number {
  const parsed = Number(String(raw ?? '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TICKET_ATTACHMENT_MAX_SIZE_MB;
  }
  return Math.min(20, Math.max(1, Math.round(parsed)));
}

export function parseTicketAttachmentMaxSizeBytes(raw?: string | null): number {
  return parseTicketAttachmentMaxSizeMb(raw) * 1024 * 1024;
}

export function buildAcceptAttribute(mimeTypes: string[]): string {
  const parts = new Set<string>();
  for (const format of KNOWN_TICKET_ATTACHMENT_FORMATS) {
    if (mimeTypes.includes(format.mime)) {
      parts.add(format.accept);
    }
  }
  return [...parts].join(',');
}

export function formatTicketAttachmentLabels(mimeTypes: string[]): string {
  return KNOWN_TICKET_ATTACHMENT_FORMATS.filter((f) => mimeTypes.includes(f.mime))
    .map((f) => f.label)
    .join('، ');
}

export function buildTicketAttachmentFromFile(
  file: Express.Multer.File,
): TicketMessageAttachment {
  return {
    path: `tickets/${file.filename}`,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
  };
}
