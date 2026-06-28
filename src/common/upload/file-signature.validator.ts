import { BadRequestException } from '@nestjs/common';

type DetectedKind = 'jpeg' | 'png' | 'webp' | 'gif' | 'pdf';

export type { DetectedKind };

const SIGNATURES: Array<{ kind: DetectedKind; check: (buf: Buffer) => boolean }> = [
  { kind: 'jpeg', check: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    kind: 'png',
    check: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47,
  },
  {
    kind: 'webp',
    check: (b) =>
      b.length >= 12 &&
      b.toString('ascii', 0, 4) === 'RIFF' &&
      b.toString('ascii', 8, 12) === 'WEBP',
  },
  {
    kind: 'gif',
    check: (b) =>
      b.length >= 6 &&
      (b.toString('ascii', 0, 6) === 'GIF87a' || b.toString('ascii', 0, 6) === 'GIF89a'),
  },
  {
    kind: 'pdf',
    check: (b) => b.length >= 5 && b.toString('ascii', 0, 5) === '%PDF-',
  },
];

export function detectFileKind(buffer: Buffer): DetectedKind | null {
  for (const sig of SIGNATURES) {
    if (sig.check(buffer)) return sig.kind;
  }
  return null;
}

export function assertFileSignature(
  buffer: Buffer,
  allowed: readonly DetectedKind[],
  label = 'فایل',
): DetectedKind {
  const kind = detectFileKind(buffer);
  if (!kind || !allowed.includes(kind)) {
    throw new BadRequestException(`${label} نامعتبر یا پشتیبانی‌نشده است.`);
  }
  return kind;
}

/** Map detected kind to a safe file extension (ignore client originalname). */
export function extensionForKind(kind: DetectedKind): string {
  switch (kind) {
    case 'jpeg':
      return '.jpg';
    case 'png':
      return '.png';
    case 'webp':
      return '.webp';
    case 'gif':
      return '.gif';
    case 'pdf':
      return '.pdf';
  }
}
