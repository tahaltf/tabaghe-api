import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { toZohalJalaliBirthDate } from '../../common/datetime/jalali.util';
import { ZohalClient } from './zohal.client';
import {
  InquiryRestrictionService,
  type InquiryCategory,
} from './inquiry-restriction.service';
import type {
  IdentityInquiryResult,
  PostalInquiryResult,
  ZohalEnvelope,
  ZohalMatchedData,
  ZohalCardToIbanData,
  ZohalNationalIdentityData,
  ZohalPostalAddress,
  ZohalPostalCodeData,
  ZohalShahkarData,
} from './zohal.types';
import { ZOHAL_ERROR_CODE, ZOHAL_RESULT } from './zohal.types';

/**
 * کدهای خطایی که نشان می‌دهند نتیجه قطعی است و نباید مجدداً به Zohal ارسال شود.
 * خطاهای سرویس (BAD_GATEWAY) از این لیست خارج‌اند تا retry انجام شود.
 */
const DETERMINISTIC_ERROR_CODES = new Set([
  'BAD_REQUEST',
  'NATIONAL_ID_INVALID',
  'CARD_NOT_FOUND',
  'SHAHKAR_NOT_MATCHED',
  'IDENTITY_NOT_MATCHED',
  'CARD_NOT_MATCHED',
  'IBAN_NOT_MATCHED',
  'CARD_TO_IBAN_FAILED',
  'DECEASED',
  'NOT_FOUND',
  'INCOMPLETE_DATA',
]);

type InquiryOpts = {
  userId?: string;
  ipAddress?: string;
  category?: InquiryCategory;
};

@Injectable()
export class ZohalService {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly client: ZohalClient,
    private readonly prisma: PrismaService,
    @Optional() private readonly restrictions?: InquiryRestrictionService,
  ) {}

  isConfigured(): boolean {
    return this.client.isConfigured();
  }

  async assertShahkarMatched(
    mobile: string,
    nationalCode: string,
    userId?: string,
    ipAddress?: string,
  ): Promise<{ matched: true }> {
    const opts: InquiryOpts = { userId, ipAddress, category: 'identity' };
    const payload = {
      mobile: this.normalizeIranMobile(mobile),
      national_code: this.normalizeNationalCode(nationalCode),
    };
    const payloadHash = this.hashPayload(payload);

    if (userId) {
      const cached = await this.findCached(userId, 'shahkar', payloadHash);
      if (cached !== null) return { matched: true };
    }

    return this.runExternal(
      `shahkar:${payloadHash}`,
      opts,
      payloadHash,
      'shahkar',
      async () => {
        let responseRaw: unknown;
        try {
          const envelope = await this.client.post<ZohalShahkarData>(
            'inquiry/shahkar',
            payload,
          );
          responseRaw = envelope;
          this.assertSuccess(envelope, 'استعلام تطبیق موبایل و کد ملی ناموفق بود');
          if (!envelope.response_body?.data?.matched) {
            const err = new BadRequestException(
              'شماره موبایل با کد ملی مطابقت ندارد.',
            );
            await this.logInquiry(userId, 'shahkar', payloadHash, false, 'SHAHKAR_NOT_MATCHED', responseRaw, undefined, ipAddress);
            throw err;
          }
          await this.logInquiry(userId, 'shahkar', payloadHash, true, null, { matched: true }, undefined, ipAddress);
          return { matched: true as const };
        } catch (err) {
          if (!responseRaw) {
            await this.logInquiry(userId, 'shahkar', payloadHash, false, 'BAD_GATEWAY', null, undefined, ipAddress);
          }
          throw err;
        }
      },
    ) as Promise<{ matched: true }>;
  }

  async inquireNationalIdentity(
    nationalCode: string,
    birthDateRaw: string | Date,
    userId?: string,
    ipAddress?: string,
  ): Promise<IdentityInquiryResult> {
    const opts: InquiryOpts = { userId, ipAddress, category: 'identity' };
    const birthDate = toZohalJalaliBirthDate(birthDateRaw);
    if (!birthDate) {
      throw new BadRequestException('تاریخ تولد نامعتبر است.');
    }
    const payload = {
      national_code: this.normalizeNationalCode(nationalCode),
      birth_date: birthDate,
    };
    const payloadHash = this.hashPayload(payload);

    if (userId) {
      const cached = await this.findCached(userId, 'national_identity', payloadHash);
      if (cached) return cached as IdentityInquiryResult;
    }

    return this.runExternal(
      `national_identity:${payloadHash}`,
      opts,
      payloadHash,
      'national_identity',
      async () => {
        let responseRaw: unknown;
        try {
          const envelope = await this.client.post<ZohalNationalIdentityData>(
            'inquiry/national_identity_inquiry',
            payload,
          );
          responseRaw = envelope;
          this.assertSuccess(envelope, 'استعلام هویت ناموفق بود');
          const data = envelope.response_body?.data ?? {};
          if (!data.matched) {
            const err = new BadRequestException(
              'کد ملی و تاریخ تولد با اطلاعات ثبت احوال مطابقت ندارد.',
            );
            await this.logInquiry(userId, 'national_identity', payloadHash, false, 'IDENTITY_NOT_MATCHED', responseRaw, undefined, ipAddress);
            throw err;
          }
          if (data.national_code) {
            const returned = toAsciiDigits(String(data.national_code)).replace(/\D/g, '');
            if (returned && returned !== this.normalizeNationalCode(nationalCode)) {
              const err = new BadRequestException(
                'کد ملی و تاریخ تولد با اطلاعات ثبت احوال مطابقت ندارد.',
              );
              await this.logInquiry(userId, 'national_identity', payloadHash, false, 'IDENTITY_NOT_MATCHED', responseRaw, undefined, ipAddress);
              throw err;
            }
          }
          if (data.is_dead === true || data.alive === false) {
            const err = new BadRequestException(
              'طبق اطلاعات ثبت احوال این کد ملی مربوط به فرد فوت‌شده است و امکان احراز هویت وجود ندارد.',
            );
            await this.logInquiry(userId, 'national_identity', payloadHash, false, 'DECEASED', responseRaw, undefined, ipAddress);
            throw err;
          }
          const firstName = String(data.first_name ?? '').trim();
          const lastName = String(data.last_name ?? '').trim();
          if (!firstName || !lastName) {
            const err = new BadRequestException('اطلاعات هویتی از ثبت احوال ناقص است.');
            await this.logInquiry(userId, 'national_identity', payloadHash, false, 'INCOMPLETE_DATA', responseRaw, undefined, ipAddress);
            throw err;
          }
          const result: IdentityInquiryResult = {
            firstName,
            lastName,
            fatherName: data.father_name ? String(data.father_name).trim() : null,
            alive: data.alive ?? true,
            isDead: data.is_dead ?? null,
            nationalCode: String(data.national_code ?? nationalCode),
            raw: data,
          };
          await this.logInquiry(userId, 'national_identity', payloadHash, true, null, responseRaw, result, ipAddress);
          return result;
        } catch (err) {
          if (!responseRaw) {
            await this.logInquiry(userId, 'national_identity', payloadHash, false, 'BAD_GATEWAY', null, undefined, ipAddress);
          }
          throw err;
        }
      },
    ) as Promise<IdentityInquiryResult>;
  }

  async lookupPostalCode(
    postalCodeRaw: string,
    userId?: string,
    ipAddress?: string,
  ): Promise<PostalInquiryResult> {
    const postalCode = this.normalizePostalCode(postalCodeRaw);
    const payload = { postal_code: postalCode };
    const payloadHash = this.hashPayload(payload);

    const globalCached = await this.findGlobalPostalCache(postalCode);
    if (globalCached) return globalCached;

    if (userId) {
      const cached = await this.findCached(userId, 'postal_code', payloadHash);
      if (cached) return cached as PostalInquiryResult;
    }

    const opts: InquiryOpts = { userId, ipAddress, category: 'postal' };

    return this.runExternal(
      `postal_code:${payloadHash}`,
      opts,
      payloadHash,
      'postal_code',
      async () => {
        let responseRaw: unknown;
        try {
          const envelope = await this.client.post<ZohalPostalCodeData>(
            'inquiry/postal_code_inquiry',
            payload,
          );
          responseRaw = envelope;
          this.assertSuccess(envelope, 'استعلام کد پستی ناموفق بود');
          const address = envelope.response_body?.data?.address;
          if (!address || !this.isUsablePostalAddress(address)) {
            const err = new BadRequestException('آدرسی برای این کد پستی یافت نشد.');
            await this.upsertGlobalPostalCache(postalCode, false, 'NOT_FOUND', responseRaw);
            await this.logInquiry(userId, 'postal_code', payloadHash, false, 'NOT_FOUND', responseRaw, undefined, ipAddress);
            throw err;
          }
          const result: PostalInquiryResult = {
            province: this.cleanPart(address.province),
            city: this.cleanPart(address.town) || this.cleanPart(address.province),
            district: this.cleanPart(address.district),
            fullAddress: formatPostalAddress(address),
            raw: address,
          };
          await this.upsertGlobalPostalCache(postalCode, true, null, responseRaw, result);
          await this.logInquiry(userId, 'postal_code', payloadHash, true, null, responseRaw, result, ipAddress);
          return result;
        } catch (err) {
          if (!responseRaw) {
            await this.logInquiry(userId, 'postal_code', payloadHash, false, 'BAD_GATEWAY', null, undefined, ipAddress);
          }
          throw err;
        }
      },
    ) as Promise<PostalInquiryResult>;
  }

  async assertCardMatchesNationalCode(params: {
    nationalCode: string;
    birthDateRaw: string | Date;
    cardNumber: string;
  }, userId?: string, ipAddress?: string): Promise<void> {
    const opts: InquiryOpts = { userId, ipAddress, category: 'financial' };
    const birthDate = toZohalJalaliBirthDate(params.birthDateRaw);
    if (!birthDate) {
      throw new BadRequestException(
        'برای تطبیق کارت بانکی، تاریخ تولد در پروفایل لازم است.',
      );
    }
    const payload = {
      national_code: this.normalizeNationalCode(params.nationalCode),
      birth_date: birthDate,
      card_number: this.normalizeCardNumber(params.cardNumber),
    };
    const payloadHash = this.hashPayload(payload);

    const globalMatched = await this.findGlobalCardMatchCache(payloadHash);
    if (globalMatched) return;

    if (userId) {
      const cached = await this.findCached(userId, 'card_match', payloadHash);
      if (cached !== null) return;
    }

    await this.runExternal(
      `card_match:${payloadHash}`,
      opts,
      payloadHash,
      'card_match',
      async () => {
        let responseRaw: unknown;
        try {
          const envelope = await this.client.post<ZohalMatchedData>(
            'inquiry/check_card_with_national_code',
            payload,
          );
          responseRaw = envelope;
          this.assertSuccess(envelope, 'استعلام تطبیق کارت بانکی ناموفق بود');
          const cardBody = envelope.response_body;
          if (cardBody?.error_code === 'CARD_NOT_FOUND') {
            const msg =
              String(cardBody.message ?? '').trim() ||
              'کارت وارد شده در سیستم بانکی وجود ندارد.';
            const err = new BadRequestException(msg);
            await this.upsertGlobalCardMatchCache(payloadHash, payload, false, false, 'CARD_NOT_FOUND', responseRaw);
            await this.logInquiry(userId, 'card_match', payloadHash, false, 'CARD_NOT_FOUND', responseRaw, undefined, ipAddress);
            throw err;
          }
          if (!cardBody?.data?.matched) {
            const err = new BadRequestException('این کارت متعلق به شما نیست.');
            await this.upsertGlobalCardMatchCache(payloadHash, payload, false, true, 'CARD_NOT_MATCHED', responseRaw);
            await this.logInquiry(userId, 'card_match', payloadHash, false, 'CARD_NOT_MATCHED', responseRaw, undefined, ipAddress);
            throw err;
          }
          await this.upsertGlobalCardMatchCache(payloadHash, payload, true, true, null, responseRaw);
          await this.logInquiry(userId, 'card_match', payloadHash, true, null, responseRaw, undefined, ipAddress);
          return null;
        } catch (err) {
          if (!responseRaw) {
            await this.logInquiry(userId, 'card_match', payloadHash, false, 'BAD_GATEWAY', null, undefined, ipAddress);
          }
          throw err;
        }
      },
    );
  }

  /** تبدیل شماره کارت به شبا — https://zohal.io/services/convert-card-to-iban */
  async convertCardToIban(
    cardNumber: string,
    userId?: string,
    ipAddress?: string,
  ): Promise<{ iban: string }> {
    const opts: InquiryOpts = { userId, ipAddress, category: 'financial' };
    const card = this.normalizeCardNumber(cardNumber);
    const payload = { card_number: card };
    const payloadHash = this.hashPayload(payload);

    const globalIban = await this.findGlobalCardToIbanCache(card);
    if (globalIban) return { iban: globalIban };

    if (userId) {
      const cached = await this.findCached(userId, 'card_to_iban', payloadHash);
      if (cached !== null && typeof cached === 'object' && cached !== null) {
        const iban = this.extractIbanDigits(cached as Record<string, unknown>);
        if (iban) return { iban };
      }
    }

    return this.runExternal(
      `card_to_iban:${payloadHash}`,
      opts,
      payloadHash,
      'card_to_iban',
      async () => {
        let responseRaw: unknown;
        try {
          const envelope = await this.client.post<ZohalCardToIbanData>(
            'inquiry/card_to_iban',
            payload,
          );
          responseRaw = envelope;
          this.assertSuccess(envelope, 'تبدیل کارت به شبا ناموفق بود');
          const iban = this.extractIbanDigits(
            (envelope.response_body?.data ?? {}) as Record<string, unknown>,
          );
          if (!iban) {
            const err = new BadRequestException(
              'شماره شبا برای این کارت یافت نشد.',
            );
            await this.upsertGlobalCardToIbanCache(card, false, null, 'CARD_TO_IBAN_FAILED', responseRaw);
            await this.logInquiry(
              userId,
              'card_to_iban',
              payloadHash,
              false,
              'CARD_TO_IBAN_FAILED',
              responseRaw,
              undefined,
              ipAddress,
            );
            throw err;
          }
          const result = { iban };
          await this.upsertGlobalCardToIbanCache(card, true, iban, null, responseRaw);
          await this.logInquiry(
            userId,
            'card_to_iban',
            payloadHash,
            true,
            null,
            responseRaw,
            result,
            ipAddress,
          );
          return result;
        } catch (err) {
          if (!responseRaw) {
            await this.logInquiry(
              userId,
              'card_to_iban',
              payloadHash,
              false,
              'BAD_GATEWAY',
              null,
              undefined,
              ipAddress,
            );
          }
          throw err;
        }
      },
    ) as Promise<{ iban: string }>;
  }

  async assertIbanMatchesNationalCode(params: {
    nationalCode: string;
    birthDateRaw: string | Date;
    iban: string;
  }, userId?: string, ipAddress?: string): Promise<void> {
    const opts: InquiryOpts = { userId, ipAddress, category: 'financial' };
    const birthDate = toZohalJalaliBirthDate(params.birthDateRaw);
    if (!birthDate) {
      throw new BadRequestException(
        'برای تطبیق شبا، تاریخ تولد در پروفایل لازم است.',
      );
    }
    const ibanDigits = toAsciiDigits(String(params.iban ?? '')).replace(/\D/g, '').slice(-24);
    const payload = {
      national_code: this.normalizeNationalCode(params.nationalCode),
      birth_date: birthDate,
      iban: ibanDigits,
    };
    const payloadHash = this.hashPayload(payload);

    if (userId) {
      const cached = await this.findCached(userId, 'iban_match', payloadHash);
      if (cached !== null) return;
    }

    await this.runExternal(
      `iban_match:${payloadHash}`,
      opts,
      payloadHash,
      'iban_match',
      async () => {
        let responseRaw: unknown;
        try {
          const envelope = await this.client.post<ZohalMatchedData>(
            'inquiry/check_iban_with_national_code',
            payload,
          );
          responseRaw = envelope;
          this.assertSuccess(envelope, 'استعلام تطبیق شبا ناموفق بود');
          const body = envelope.response_body;
          if (!body?.data?.matched) {
            const err = new BadRequestException('شماره شبا با کد ملی مطابقت ندارد.');
            await this.logInquiry(userId, 'iban_match', payloadHash, false, 'IBAN_NOT_MATCHED', responseRaw, undefined, ipAddress);
            throw err;
          }
          await this.logInquiry(userId, 'iban_match', payloadHash, true, null, responseRaw, undefined, ipAddress);
          return null;
        } catch (err) {
          if (!responseRaw) {
            await this.logInquiry(userId, 'iban_match', payloadHash, false, 'BAD_GATEWAY', null, undefined, ipAddress);
          }
          throw err;
        }
      },
    );
  }

  normalizeShabaDigits(value: string): string {
    return toAsciiDigits(String(value ?? '')).replace(/^IR/i, '').replace(/\D/g, '').slice(0, 24);
  }

  normalizeIranMobile(phone: string): string {
    const digits = toAsciiDigits(String(phone ?? '')).replace(/\D/g, '');
    let normalized = digits;
    if (digits.startsWith('98') && digits.length >= 12) {
      normalized = `0${digits.slice(2, 12)}`;
    } else if (digits.startsWith('9') && digits.length === 10) {
      normalized = `0${digits}`;
    } else if (digits.startsWith('09') && digits.length >= 11) {
      normalized = digits.slice(0, 11);
    }
    if (!/^09\d{9}$/.test(normalized)) {
      throw new BadRequestException('شماره موبایل نامعتبر است.');
    }
    return normalized;
  }

  normalizeNationalCode(value: string): string {
    const digits = toAsciiDigits(String(value ?? '')).replace(/\D/g, '');
    if (!/^\d{10}$/.test(digits)) {
      throw new BadRequestException('کد ملی باید ۱۰ رقم باشد.');
    }
    return digits;
  }

  normalizePostalCode(value: string): string {
    const digits = toAsciiDigits(String(value ?? '')).replace(/\D/g, '');
    if (!/^\d{10}$/.test(digits)) {
      throw new BadRequestException('کد پستی باید ۱۰ رقم باشد.');
    }
    return digits;
  }

  normalizeCardNumber(value: string): string {
    const digits = toAsciiDigits(String(value ?? '')).replace(/\D/g, '');
    if (!/^\d{16}$/.test(digits)) {
      throw new BadRequestException('شماره کارت باید ۱۶ رقم باشد.');
    }
    return digits;
  }

  private extractIbanDigits(data: Record<string, unknown>): string | null {
    const candidates = [
      data.iban,
      data.IBAN,
      data.sheba,
      data.account_iban,
      data.deposit,
    ];
    for (const candidate of candidates) {
      const digits = toAsciiDigits(String(candidate ?? ''))
        .replace(/\D/g, '')
        .slice(-24);
      if (/^\d{24}$/.test(digits)) return digits;
    }
    return null;
  }

  // ─── Cache helpers ──────────────────────────────────────────────────────────

  private hashPayload(obj: Record<string, string>): string {
    const sorted = Object.keys(obj)
      .sort()
      .reduce<Record<string, string>>((acc, k) => { acc[k] = obj[k]; return acc; }, {});
    return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
  }

  /**
   * جستجوی آخرین لاگ موفق برای همین کاربر + سرویس + payload.
   * اگر لاگ ناموفق قطعی پیدا شد، همان خطا را throw می‌کند.
   * اگر نتیجه‌ای پیدا نشد، null برمی‌گرداند.
   */
  private async findCached(
    userId: string,
    service: string,
    payloadHash: string,
  ): Promise<unknown> {
    const log = await this.prisma.zohalInquiryLog.findFirst({
      where: { userId, service, payloadHash },
      orderBy: { createdAt: 'desc' },
    });

    if (!log) return null;

    if (log.success && log.responseRaw) {
      const raw = log.responseRaw as Record<string, unknown>;
      if (service === 'shahkar' || service === 'card_match' || service === 'iban_match' || service === 'card_to_iban') {
        return raw;
      }
      return log.responseRaw;
    }

    if (!log.success && log.errorCode && DETERMINISTIC_ERROR_CODES.has(log.errorCode)) {
      const messageMap: Record<string, string> = {
        SHAHKAR_NOT_MATCHED: 'شماره موبایل با کد ملی مطابقت ندارد.',
        IDENTITY_NOT_MATCHED: 'کد ملی و تاریخ تولد با اطلاعات ثبت احوال مطابقت ندارد.',
        CARD_NOT_FOUND: 'کارت وارد شده در سیستم بانکی وجود ندارد.',
        CARD_NOT_MATCHED: 'این کارت متعلق به شما نیست.',
        IBAN_NOT_MATCHED: 'شماره شبا با کد ملی مطابقت ندارد.',
        CARD_TO_IBAN_FAILED: 'تبدیل کارت به شبا ناموفق بود.',
        NATIONAL_ID_INVALID: 'کد ملی نامعتبر است.',
        DECEASED: 'طبق اطلاعات ثبت احوال این کد ملی مربوط به فرد فوت‌شده است.',
        NOT_FOUND: 'آدرسی برای این کد پستی یافت نشد.',
        INCOMPLETE_DATA: 'اطلاعات هویتی از ثبت احوال ناقص است.',
        BAD_REQUEST: 'درخواست نامعتبر است.',
      };
      throw new BadRequestException(
        messageMap[log.errorCode] ?? 'استعلام قبلاً ناموفق بوده است.',
      );
    }

    return null;
  }

  private async logInquiry(
    userId: string | undefined,
    service: string,
    payloadHash: string,
    success: boolean,
    errorCode: string | null,
    responseRaw: unknown,
    cachedResult?: unknown,
    ipAddress?: string,
  ): Promise<void> {
    if (!userId) return;
    try {
      await this.prisma.zohalInquiryLog.create({
        data: {
          userId,
          service,
          payloadHash,
          success,
          errorCode,
          responseRaw: (cachedResult ?? responseRaw) as never,
          ipAddress: ipAddress ?? null,
        },
      });
    } catch {
      // لاگ شکست نباید باعث خطا در جریان اصلی شود
    }
  }

  private async runExternal<T>(
    dedupKey: string,
    opts: InquiryOpts,
    payloadHash: string,
    _service: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const existing = this.inFlight.get(dedupKey);
    if (existing) return existing as Promise<T>;

    const promise = (async () => {
      if (opts.userId && this.restrictions && opts.category) {
        await this.restrictions.assertCanInquire(opts.userId, opts.category);
        await this.restrictions.assertRateLimit(opts.userId);
        await this.restrictions.recordNewPayload(opts.userId, opts.category);
      }
      try {
        const result = await fn();
        if (opts.userId && this.restrictions && opts.category) {
          await this.restrictions.recordSuccess(opts.userId, opts.category);
        }
        return result;
      } catch (err) {
        if (opts.userId && this.restrictions && opts.category) {
          await this.restrictions.recordFailure(opts.userId, opts.category);
        }
        throw err;
      } finally {
        this.inFlight.delete(dedupKey);
      }
    })();

    this.inFlight.set(dedupKey, promise);
    return promise;
  }

  private async findGlobalPostalCache(postalCode: string): Promise<PostalInquiryResult | null> {
    const row = await this.prisma.postalCodeCache.findUnique({
      where: { postalCode },
    });
    if (!row) return null;
    if (row.success) {
      return {
        province: row.province,
        city: row.city,
        district: row.district ?? '',
        fullAddress: row.fullAddress,
        raw: (row.responseRaw as { address?: ZohalPostalAddress })?.address ?? {},
      };
    }
    if (row.errorCode === 'NOT_FOUND') {
      throw new BadRequestException('آدرسی برای این کد پستی یافت نشد.');
    }
    return null;
  }

  private async upsertGlobalPostalCache(
    postalCode: string,
    success: boolean,
    errorCode: string | null,
    responseRaw: unknown,
    result?: PostalInquiryResult,
  ): Promise<void> {
    try {
      await this.prisma.postalCodeCache.upsert({
        where: { postalCode },
        create: {
          postalCode,
          province: result?.province ?? '',
          city: result?.city ?? '',
          district: result?.district ?? null,
          fullAddress: result?.fullAddress ?? '',
          responseRaw: responseRaw as never,
          success,
          errorCode,
        },
        update: {
          province: result?.province ?? '',
          city: result?.city ?? '',
          district: result?.district ?? null,
          fullAddress: result?.fullAddress ?? '',
          responseRaw: responseRaw as never,
          success,
          errorCode,
        },
      });
    } catch {
      // ignore cache write failures
    }
  }

  private async findGlobalCardMatchCache(cacheKey: string): Promise<boolean> {
    const row = await this.prisma.cardOwnerMatchCache.findUnique({
      where: { cacheKey },
    });
    if (!row) return false;
    if (row.success && row.matched) return true;
    this.throwCardMatchCacheError(row.errorCode);
  }

  private throwCardMatchCacheError(errorCode: string | null): never {
    if (errorCode === 'CARD_NOT_FOUND') {
      throw new BadRequestException('کارت وارد شده در سیستم بانکی وجود ندارد.');
    }
    if (errorCode === 'CARD_NOT_MATCHED') {
      throw new BadRequestException('این کارت متعلق به شما نیست.');
    }
    throw new BadRequestException('استعلام تطبیق کارت بانکی ناموفق بود.');
  }

  private async upsertGlobalCardMatchCache(
    cacheKey: string,
    payload: {
      national_code: string;
      birth_date: string;
      card_number: string;
    },
    matched: boolean,
    success: boolean,
    errorCode: string | null,
    responseRaw: unknown,
  ): Promise<void> {
    try {
      await this.prisma.cardOwnerMatchCache.upsert({
        where: { cacheKey },
        create: {
          cacheKey,
          cardNumber: payload.card_number,
          nationalCode: payload.national_code,
          birthDate: payload.birth_date,
          matched,
          success,
          errorCode,
          responseRaw: responseRaw as never,
        },
        update: {
          matched,
          success,
          errorCode,
          responseRaw: responseRaw as never,
        },
      });
    } catch {
      // ignore cache write failures
    }
  }

  private async findGlobalCardToIbanCache(cardNumber: string): Promise<string | null> {
    const row = await this.prisma.cardToIbanCache.findUnique({
      where: { cardNumber },
    });
    if (!row) return null;
    if (row.success && row.shabaNumber) return row.shabaNumber;
    this.throwCardToIbanCacheError(row.errorCode);
  }

  private throwCardToIbanCacheError(errorCode: string | null): never {
    if (errorCode === 'CARD_TO_IBAN_FAILED') {
      throw new BadRequestException('شماره شبا برای این کارت یافت نشد.');
    }
    throw new BadRequestException('تبدیل کارت به شبا ناموفق بود.');
  }

  private async upsertGlobalCardToIbanCache(
    cardNumber: string,
    success: boolean,
    shabaNumber: string | null,
    errorCode: string | null,
    responseRaw: unknown,
  ): Promise<void> {
    try {
      await this.prisma.cardToIbanCache.upsert({
        where: { cardNumber },
        create: {
          cardNumber,
          shabaNumber,
          success,
          errorCode,
          responseRaw: responseRaw as never,
        },
        update: {
          shabaNumber,
          success,
          errorCode,
          responseRaw: responseRaw as never,
        },
      });
    } catch {
      // ignore cache write failures
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private assertSuccess<T>(
    envelope: ZohalEnvelope<T>,
    fallback: string,
  ): void {
    const result = Number(envelope?.result);
    const message = String(envelope?.response_body?.message ?? '').trim();
    const errorCode = String(envelope?.response_body?.error_code ?? '').trim();
    const userMessage = this.toUserMessage(message, fallback, errorCode);

    if (this.isProviderFailureCode(errorCode) || result === ZOHAL_RESULT.INTERNAL_ERROR) {
      throw new BadGatewayException(userMessage);
    }
    if (result === ZOHAL_RESULT.SUCCESS) return;
    if (
      result === ZOHAL_RESULT.INVALID ||
      result === ZOHAL_RESULT.BAD_INPUT
    ) {
      throw new BadRequestException(userMessage);
    }
    throw new BadGatewayException(userMessage);
  }

  private isProviderFailureCode(errorCode: string): boolean {
    const code = errorCode.trim().toUpperCase();
    return (
      code === ZOHAL_ERROR_CODE.INTERNAL_ERROR ||
      code === ZOHAL_ERROR_CODE.SERVICE_UNAVAILABLE ||
      code === ZOHAL_ERROR_CODE.SERVICE_NOT_FOUND
    );
  }

  private isUsablePostalAddress(address: ZohalPostalAddress): boolean {
    return Boolean(
      this.cleanPart(address.province) ||
        this.cleanPart(address.town) ||
        this.cleanPart(address.street) ||
        this.cleanPart(address.street2) ||
        this.cleanPart(address.district) ||
        this.cleanPart(address.number) ||
        this.cleanPart(address.building_name),
    );
  }

  private toUserMessage(
    raw: string,
    fallback: string,
    errorCode?: string,
  ): string {
    const code = String(errorCode ?? '').trim().toUpperCase();
    if (code === ZOHAL_ERROR_CODE.SERVICE_UNAVAILABLE) {
      return 'سرویس استعلام در حال حاضر در دسترس نیست.';
    }
    if (code === ZOHAL_ERROR_CODE.SERVICE_NOT_FOUND) {
      return 'سرویس استعلام یافت نشد.';
    }
    if (code === ZOHAL_ERROR_CODE.INTERNAL_ERROR) {
      return fallback;
    }
    if (code === 'CARD_NOT_FOUND') {
      return raw || 'کارت وارد شده در سیستم بانکی وجود ندارد.';
    }
    if (code === 'NATIONAL_ID_INVALID') {
      return raw || 'شناسه ملی نامعتبر است.';
    }
    const lower = raw.toLowerCase();
    if (!raw) return fallback;
    if (lower.includes('national code') || /کد\s*ملی/.test(raw)) {
      return 'کد ملی نامعتبر است.';
    }
    if (lower.includes('birth_date') || lower.includes('jalali')) {
      return 'تاریخ تولد نامعتبر است.';
    }
    if (lower.includes('postal') || /کد\s*پستی/.test(raw)) {
      return 'کد پستی نامعتبر است یا یافت نشد.';
    }
    if (lower.includes('mobile') || /موبایل|تلفن/.test(raw)) {
      return 'شماره موبایل نامعتبر است.';
    }
    if (/موفق/.test(raw)) return fallback;
    return raw.length <= 180 ? raw : fallback;
  }

  private cleanPart(value: string | number | null | undefined): string {
    const text = String(value ?? '').trim();
    if (!text || text === '-') return '';
    return text;
  }
}

function toAsciiDigits(text: string): string {
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  const arabic = '٠١٢٣٤٥٦٧٨٩';
  return String(text ?? '').replace(/[۰-۹٠-٩]/g, (ch) => {
    const pi = persian.indexOf(ch);
    if (pi >= 0) return String(pi);
    const ai = arabic.indexOf(ch);
    return ai >= 0 ? String(ai) : ch;
  });
}

export function formatPostalAddress(address: ZohalPostalAddress): string {
  const skip = (v: string | number | null | undefined) => {
    const text = String(v ?? '').trim();
    return !text || text === '-' ? '' : text;
  };
  const parts = [
    skip(address.street),
    skip(address.street2),
    skip(address.district),
    skip(address.number) ? `پلاک ${skip(address.number)}` : '',
    skip(address.building_name),
    skip(address.floor) ? `طبقه ${skip(address.floor)}` : '',
    skip(address.side_floor) ? `واحد ${skip(address.side_floor)}` : '',
    skip(address.description),
  ].filter(Boolean);
  return parts.join('، ');
}
