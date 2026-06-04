import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

function toLatinDigits(text: string): string {
  return text.replace(/[۰-۹٠-٩]/g, (ch) => {
    const pi = PERSIAN_DIGITS.indexOf(ch);
    if (pi >= 0) return String(pi);
    const ai = ARABIC_DIGITS.indexOf(ch);
    return ai >= 0 ? String(ai) : ch;
  });
}

/** نرمال‌سازی موبایل ایران به 09XXXXXXXXX */
export function normalizeIranMobile(input: string): string | null {
  let digits = toLatinDigits(String(input ?? '').trim()).replace(/\D/g, '');
  if (digits.startsWith('98') && digits.length === 12) {
    digits = `0${digits.slice(2)}`;
  }
  if (digits.startsWith('9') && digits.length === 10) {
    digits = `0${digits}`;
  }
  if (!/^09\d{9}$/.test(digits)) return null;
  return digits;
}

/**
 * undefined = همه کاربران · آرایه خالی = بدون گیرنده · غیره = گیرندگان مشخص
 */
export async function resolveAdminRecipientUserIds(
  prisma: PrismaService,
  userIds?: string[],
  phones?: string[],
): Promise<string[] | undefined> {
  const hasUserIds = Array.isArray(userIds);
  const hasPhones = Array.isArray(phones) && phones.length > 0;

  if (!hasUserIds && !hasPhones) {
    return undefined;
  }

  const idSet = new Set<string>();
  for (const raw of userIds ?? []) {
    const id = raw.trim();
    if (id) idSet.add(id);
  }

  if (hasPhones) {
    const normalizedPhones = [
      ...new Set(
        (phones ?? [])
          .map((p) => normalizeIranMobile(p))
          .filter((p): p is string => !!p),
      ),
    ];
    if (normalizedPhones.length === 0) {
      throw new BadRequestException('شماره موبایل معتبر وارد کنید');
    }
    const users = await prisma.user.findMany({
      where: { phone: { in: normalizedPhones } },
      select: { id: true, phone: true },
    });
    for (const u of users) {
      idSet.add(u.id);
    }
    const foundPhones = new Set(users.map((u) => u.phone));
    const missing = normalizedPhones.filter((p) => !foundPhones.has(p));
    if (missing.length > 0) {
      throw new BadRequestException(
        `کاربری با این شماره موبایل یافت نشد: ${missing.join('، ')}`,
      );
    }
  }

  if (idSet.size === 0) {
    return [];
  }
  return [...idSet];
}
