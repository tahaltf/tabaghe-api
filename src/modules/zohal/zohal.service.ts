import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { toZohalJalaliBirthDate } from '../../common/datetime/jalali.util';
import { ZohalClient } from './zohal.client';
import type {
  IdentityInquiryResult,
  PostalInquiryResult,
  ZohalEnvelope,
  ZohalMatchedData,
  ZohalNationalIdentityData,
  ZohalPostalAddress,
  ZohalPostalCodeData,
  ZohalShahkarData,
} from './zohal.types';
import { ZOHAL_ERROR_CODE, ZOHAL_RESULT } from './zohal.types';

@Injectable()
export class ZohalService {
  constructor(private readonly client: ZohalClient) {}

  isConfigured(): boolean {
    return this.client.isConfigured();
  }

  async assertShahkarMatched(
    mobile: string,
    nationalCode: string,
  ): Promise<{ matched: true }> {
    const payload = {
      mobile: this.normalizeIranMobile(mobile),
      national_code: this.normalizeNationalCode(nationalCode),
    };
    const envelope = await this.client.post<ZohalShahkarData>(
      'inquiry/shahkar',
      payload,
    );
    this.assertSuccess(envelope, 'استعلام تطبیق موبایل و کد ملی ناموفق بود');
    if (!envelope.response_body?.data?.matched) {
      throw new BadRequestException(
        'شماره موبایل با کد ملی مطابقت ندارد.',
      );
    }
    return { matched: true };
  }

  async inquireNationalIdentity(
    nationalCode: string,
    birthDateRaw: string | Date,
  ): Promise<IdentityInquiryResult> {
    const birthDate = toZohalJalaliBirthDate(birthDateRaw);
    if (!birthDate) {
      throw new BadRequestException('تاریخ تولد نامعتبر است.');
    }
    const envelope = await this.client.post<ZohalNationalIdentityData>(
      'inquiry/national_identity_inquiry',
      {
        national_code: this.normalizeNationalCode(nationalCode),
        birth_date: birthDate,
      },
    );
    this.assertSuccess(envelope, 'استعلام هویت ناموفق بود');
    const data = envelope.response_body?.data ?? {};
    if (!data.matched) {
      throw new BadRequestException(
        'کد ملی و تاریخ تولد با اطلاعات ثبت احوال مطابقت ندارد.',
      );
    }
    if (data.national_code) {
      const returned = toAsciiDigits(String(data.national_code)).replace(
        /\D/g,
        '',
      );
      if (returned && returned !== this.normalizeNationalCode(nationalCode)) {
        throw new BadRequestException(
          'کد ملی و تاریخ تولد با اطلاعات ثبت احوال مطابقت ندارد.',
        );
      }
    }
    if (data.is_dead === true || data.alive === false) {
      throw new BadRequestException(
        'طبق اطلاعات ثبت احوال این کد ملی مربوط به فرد فوت‌شده است و امکان احراز هویت وجود ندارد.',
      );
    }
    const firstName = String(data.first_name ?? '').trim();
    const lastName = String(data.last_name ?? '').trim();
    if (!firstName || !lastName) {
      throw new BadRequestException('اطلاعات هویتی از ثبت احوال ناقص است.');
    }
    // اگر فیلد `alive` مقدار نداشته باشد (null/undefined) بعد از عبور از چک‌ها
    // آن را به عنوان زنده در نظر می‌گیریم.
    const alive = data.alive ?? true;
    return {
      firstName,
      lastName,
      fatherName: data.father_name ? String(data.father_name).trim() : null,
      alive,
      isDead: data.is_dead ?? null,
      nationalCode: String(data.national_code ?? nationalCode),
      raw: data,
    };
  }

  async lookupPostalCode(postalCodeRaw: string): Promise<PostalInquiryResult> {
    const postalCode = this.normalizePostalCode(postalCodeRaw);
    const envelope = await this.client.post<ZohalPostalCodeData>(
      'inquiry/postal_code_inquiry',
      { postal_code: postalCode },
    );
    this.assertSuccess(envelope, 'استعلام کد پستی ناموفق بود');
    const address = envelope.response_body?.data?.address;
    if (!address || !this.isUsablePostalAddress(address)) {
      throw new BadRequestException('آدرسی برای این کد پستی یافت نشد.');
    }
    return {
      province: this.cleanPart(address.province),
      city: this.cleanPart(address.town) || this.cleanPart(address.province),
      district: this.cleanPart(address.district),
      fullAddress: formatPostalAddress(address),
      raw: address,
    };
  }

  async assertCardMatchesNationalCode(params: {
    nationalCode: string;
    birthDateRaw: string | Date;
    cardNumber: string;
  }): Promise<void> {
    const birthDate = toZohalJalaliBirthDate(params.birthDateRaw);
    if (!birthDate) {
      throw new BadRequestException(
        'برای تطبیق کارت بانکی، تاریخ تولد در پروفایل لازم است.',
      );
    }
    const envelope = await this.client.post<ZohalMatchedData>(
      'inquiry/check_card_with_national_code',
      {
        national_code: this.normalizeNationalCode(params.nationalCode),
        birth_date: birthDate,
        card_number: this.normalizeCardNumber(params.cardNumber),
      },
    );
    this.assertSuccess(envelope, 'استعلام تطبیق کارت بانکی ناموفق بود');
    const cardBody = envelope.response_body;
    if (cardBody?.error_code === 'CARD_NOT_FOUND') {
      throw new BadRequestException(
        String(cardBody.message ?? '').trim() ||
          'کارت وارد شده در سیستم بانکی وجود ندارد.',
      );
    }
    if (!cardBody?.data?.matched) {
      throw new BadRequestException(
        'شماره کارت با کد ملی مطابقت ندارد.',
      );
    }
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
