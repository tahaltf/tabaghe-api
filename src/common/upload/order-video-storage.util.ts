import { existsSync, unlink } from 'fs';
import { join } from 'path';

const PROCESS_CWD_UPLOADS = join(process.cwd(), 'uploads');

export const ORDER_VIDEO_DB_FIELDS = [
  'packagingVideo',
  'buyerPackagingVideo',
  'unboxingVideo',
  'sellerUnboxingVideo',
  'returnPackagingVideo',
] as const;

export type OrderVideoDbField = (typeof ORDER_VIDEO_DB_FIELDS)[number];

export function collectOrderVideoFilenames(
  order: Partial<Record<OrderVideoDbField, string | null | undefined>>,
): string[] {
  const names: string[] = [];
  for (const field of ORDER_VIDEO_DB_FIELDS) {
    const name = order[field];
    if (typeof name === 'string' && name.trim()) {
      names.push(name.trim());
    }
  }
  return names;
}

export function deleteOrderVideoFile(filename: string): void {
  if (!filename?.trim()) return;
  try {
    const safe = filename
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\.\./g, '');
    const baseName = safe.replace(/^uploads\/orders\/videos\//, '');
    const full = join(PROCESS_CWD_UPLOADS, 'orders', 'videos', baseName);
    if (existsSync(full)) unlink(full, () => undefined);
  } catch {
    /* non-fatal */
  }
}

export function clearedOrderVideoUpdateData(): Record<OrderVideoDbField, null> {
  return {
    packagingVideo: null,
    buyerPackagingVideo: null,
    unboxingVideo: null,
    sellerUnboxingVideo: null,
    returnPackagingVideo: null,
  };
}

export function orderHasStoredVideos(
  order: Partial<Record<OrderVideoDbField, string | null | undefined>>,
): boolean {
  return collectOrderVideoFilenames(order).length > 0;
}
