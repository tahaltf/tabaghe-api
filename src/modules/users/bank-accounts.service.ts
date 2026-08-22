import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  formatMaskedCard,
  resolveBankByCard,
} from '../../common/kyc/iran-bank-bin.util';
import {
  formatShabaDisplay,
  hasMinimumFinancialFields,
  isFinancialVerified,
  isIdentityVerified,
  maskBankCardNumber,
  normalizeCardDigits,
} from '../../common/kyc/kyc-profile.util';
import { ZohalService } from '../zohal/zohal.service';
import { ZohalSettingsService } from '../zohal/zohal-settings.service';
import { InquiryRestrictionService } from '../zohal/inquiry-restriction.service';
import { isZohalServiceFailure } from '../zohal/zohal.errors';
import type { BankAccountDto, FinancialVerificationDto } from './dto/financial-verification.dto';

export type BankAccountPreview = {
  bankName: string | null;
  bankBin: string;
  maskedCard: string;
  holderName: string;
  shabaNumber: string | null;
  shabaDisplay: string | null;
  hasCard: boolean;
  hasShaba: boolean;
};

export type PublicBankAccount = {
  id: string;
  label: string | null;
  bankName: string | null;
  bankCardMasked: string | null;
  bankCardBin: string | null;
  shabaNumber: string | null;
  isDefault: boolean;
  verifiedAt: Date | null;
};

@Injectable()
export class BankAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly zohal: ZohalService,
    private readonly zohalSettings: ZohalSettingsService,
    private readonly inquiryRestrictions: InquiryRestrictionService,
  ) {}

  async list(userId: string): Promise<PublicBankAccount[]> {
    const rows = await this.prisma.userBankAccount.findMany({
      where: this.activeWhere(userId),
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((r) => this.toPublic(r));
  }

  async preview(
    userId: string,
    dto: FinancialVerificationDto,
    ipAddress?: string | null,
  ): Promise<BankAccountPreview> {
    const user = await this.loadUserForFinancial(userId);
    this.assertIdentityReady(user);
    const parsed = this.parseFinancialInput(dto);
    await this.assertNotActiveDuplicate(userId, parsed.cardNumber);
    await this.runFinancialInquiries(user, parsed.cardNumber, ipAddress);
    const shabaNumber = await this.resolveShabaFromCard(
      user.id,
      parsed.cardNumber,
      ipAddress,
    );
    const holderName =
      `${String(user.firstName ?? '').trim()} ${String(user.lastName ?? '').trim()}`.trim() ||
      user.phone;
    const bankInfo = resolveBankByCard(parsed.cardNumber);
    return {
      bankName: bankInfo.bankName,
      bankBin: bankInfo.bin,
      maskedCard: formatMaskedCard(parsed.cardNumber),
      holderName,
      shabaNumber,
      shabaDisplay: shabaNumber ? formatShabaDisplay(shabaNumber) : null,
      hasCard: true,
      hasShaba: !!shabaNumber,
    };
  }

  async create(
    userId: string,
    dto: BankAccountDto,
    ipAddress?: string | null,
  ): Promise<PublicBankAccount> {
    const user = await this.loadUserForFinancial(userId);
    this.assertIdentityReady(user);
    const parsed = this.parseFinancialInput(dto);

    await this.assertNotActiveDuplicate(userId, parsed.cardNumber);

    const deletedSame = await this.findDeletedByCard(userId, parsed.cardNumber);
    if (deletedSame) {
      return this.reactivateAccount(userId, user, deletedSame, dto, ipAddress);
    }

    await this.inquiryRestrictions.assertCanAddBankAccount(userId);
    await this.runFinancialInquiries(user, parsed.cardNumber, ipAddress);
    const shabaNumber = await this.resolveShabaFromCard(
      userId,
      parsed.cardNumber,
      ipAddress,
    );
    const bankInfo = resolveBankByCard(parsed.cardNumber);
    const count = await this.countActive(userId);
    const isDefault = count === 0 || dto.label === '__default__';
    if (isDefault) {
      await this.clearDefaultFlags(userId);
    }
    const row = await this.prisma.userBankAccount.create({
      data: {
        userId,
        label: dto.label && dto.label !== '__default__' ? dto.label : null,
        bankCardNumber: parsed.cardNumber,
        bankCardBin: bankInfo.bin || null,
        bankName: bankInfo.bankName,
        shabaNumber,
        isDefault: isDefault || count === 0,
        verifiedAt: new Date(),
      },
    });
    if (row.isDefault) await this.syncUserDefaultFields(userId, row);
    return this.toPublic(row);
  }

  async update(
    userId: string,
    accountId: string,
    dto: BankAccountDto,
    ipAddress?: string | null,
  ): Promise<PublicBankAccount> {
    const existing = await this.findActiveAccount(userId, accountId);
    const user = await this.loadUserForFinancial(userId);
    this.assertIdentityReady(user);
    const parsed = this.parseFinancialInput(dto);

    if (parsed.cardNumber !== existing.bankCardNumber) {
      await this.assertNotActiveDuplicate(userId, parsed.cardNumber, accountId);
      const deletedSame = await this.findDeletedByCard(userId, parsed.cardNumber);
      if (deletedSame) {
        throw new BadRequestException(
          'این کارت قبلاً ثبت شده بود. برای استفاده مجدد، همان شماره کارت را دوباره اضافه کنید.',
        );
      }
    }

    await this.runFinancialInquiries(user, parsed.cardNumber, ipAddress);
    const shabaNumber = await this.resolveShabaFromCard(
      userId,
      parsed.cardNumber,
      ipAddress,
    );
    const bankInfo = resolveBankByCard(parsed.cardNumber);
    const row = await this.prisma.userBankAccount.update({
      where: { id: accountId },
      data: {
        label: dto.label ?? existing.label,
        bankCardNumber: parsed.cardNumber,
        bankCardBin: bankInfo.bin ?? null,
        bankName: bankInfo.bankName,
        shabaNumber,
        verifiedAt: new Date(),
      },
    });
    if (row.isDefault) await this.syncUserDefaultFields(userId, row);
    return this.toPublic(row);
  }

  async remove(userId: string, accountId: string): Promise<void> {
    const existing = await this.findActiveAccount(userId, accountId);
    await this.prisma.userBankAccount.update({
      where: { id: accountId },
      data: { deletedAt: new Date(), isDefault: false },
    });
    if (existing.isDefault) {
      const next = await this.prisma.userBankAccount.findFirst({
        where: this.activeWhere(userId),
        orderBy: { createdAt: 'desc' },
      });
      if (next) {
        await this.prisma.userBankAccount.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
        await this.syncUserDefaultFields(userId, next);
      } else {
        await this.prisma.user.update({
          where: { id: userId },
          data: {
            bankCardNumber: null,
            bankCardBin: null,
            bankName: null,
            shabaNumber: null,
            financialVerifiedAt: null,
          },
        });
      }
    }
  }

  async setDefault(userId: string, accountId: string): Promise<PublicBankAccount> {
    await this.findActiveAccount(userId, accountId);
    await this.clearDefaultFlags(userId);
    const updated = await this.prisma.userBankAccount.update({
      where: { id: accountId },
      data: { isDefault: true },
    });
    await this.syncUserDefaultFields(userId, updated);
    return this.toPublic(updated);
  }

  async getDefaultAccount(userId: string) {
    return this.prisma.userBankAccount.findFirst({
      where: { ...this.activeWhere(userId), isDefault: true },
    });
  }

  private activeWhere(userId: string) {
    return { userId, deletedAt: null };
  }

  private async countActive(userId: string): Promise<number> {
    return this.prisma.userBankAccount.count({ where: this.activeWhere(userId) });
  }

  private async findActiveAccount(userId: string, accountId: string) {
    const row = await this.prisma.userBankAccount.findFirst({
      where: { id: accountId, ...this.activeWhere(userId) },
    });
    if (!row) throw new NotFoundException('حساب بانکی یافت نشد');
    return row;
  }

  private async findDeletedByCard(userId: string, cardNumber: string) {
    return this.prisma.userBankAccount.findFirst({
      where: { userId, bankCardNumber: cardNumber, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
    });
  }

  private async assertNotActiveDuplicate(
    userId: string,
    cardNumber: string,
    excludeAccountId?: string,
  ): Promise<void> {
    const duplicate = await this.prisma.userBankAccount.findFirst({
      where: {
        ...this.activeWhere(userId),
        bankCardNumber: cardNumber,
        ...(excludeAccountId ? { id: { not: excludeAccountId } } : {}),
      },
    });
    if (duplicate) {
      throw new BadRequestException('این کارت قبلاً در حساب‌های شما ثبت شده است.');
    }
  }

  private async reactivateAccount(
    userId: string,
    user: {
      id: string;
      nationalCode: string | null;
      birthDate: Date | null;
    },
    deletedRow: {
      id: string;
      label: string | null;
      bankCardNumber: string | null;
      bankCardBin: string | null;
      bankName: string | null;
      shabaNumber: string | null;
    },
    dto: BankAccountDto,
    ipAddress?: string | null,
  ): Promise<PublicBankAccount> {
    await this.inquiryRestrictions.assertCanAddBankAccount(userId);
    const cardNumber = deletedRow.bankCardNumber;
    if (!cardNumber) {
      throw new BadRequestException('شماره کارت حساب حذف‌شده نامعتبر است.');
    }

    await this.runFinancialInquiries(user, cardNumber, ipAddress);
    const resolvedShaba = await this.resolveShabaFromCard(
      userId,
      cardNumber,
      ipAddress,
    );

    const activeCount = await this.countActive(userId);
    const isDefault = activeCount === 0 || dto.label === '__default__';
    if (isDefault) await this.clearDefaultFlags(userId);

    const bankInfo = resolveBankByCard(cardNumber);

    const row = await this.prisma.userBankAccount.update({
      where: { id: deletedRow.id },
      data: {
        deletedAt: null,
        label: dto.label && dto.label !== '__default__' ? dto.label : deletedRow.label,
        bankCardBin: bankInfo.bin ?? deletedRow.bankCardBin,
        bankName: bankInfo.bankName ?? deletedRow.bankName,
        shabaNumber: resolvedShaba ?? deletedRow.shabaNumber,
        isDefault: isDefault || activeCount === 0,
        verifiedAt: new Date(),
      },
    });
    if (row.isDefault) await this.syncUserDefaultFields(userId, row);
    return this.toPublic(row);
  }

  private async clearDefaultFlags(userId: string): Promise<void> {
    await this.prisma.userBankAccount.updateMany({
      where: this.activeWhere(userId),
      data: { isDefault: false },
    });
  }

  private parseFinancialInput(dto: FinancialVerificationDto): { cardNumber: string } {
    const cardNumber = normalizeCardDigits(dto.cardNumber);
    if (!hasMinimumFinancialFields(cardNumber)) {
      throw new BadRequestException('شماره کارت باید ۱۶ رقم باشد.');
    }
    return { cardNumber };
  }

  private async resolveShabaFromCard(
    userId: string,
    cardNumber: string,
    ipAddress?: string | null,
  ): Promise<string | null> {
    const restriction = await this.inquiryRestrictions.getSnapshot(userId);
    if (restriction.manualEntryOnly) return null;
    await this.assertCardMatchInquiryAvailable();
    const { iban } = await this.zohal.convertCardToIban(
      cardNumber,
      userId,
      ipAddress ?? undefined,
    );
    return iban;
  }

  private async runFinancialInquiries(
    user: {
      id: string;
      nationalCode: string | null;
      birthDate: Date | null;
    },
    cardNumber: string,
    ipAddress?: string | null,
  ): Promise<void> {
    const restriction = await this.inquiryRestrictions.getSnapshot(user.id);
    if (restriction.inquiryBlocked) {
      throw new BadRequestException(
        'دسترسی استعلام شما محدود شده است. لطفاً با پشتیبانی تماس بگیرید.',
      );
    }
    if (restriction.manualEntryOnly) {
      return;
    }
    await this.assertCardMatch(user, cardNumber, ipAddress);
  }

  private async assertCardMatchInquiryAvailable(): Promise<void> {
    if (await this.zohalSettings.isCardMatchActive()) return;

    const status = await this.zohalSettings.getAdminStatus();
    if (!status.tokenConfigured) {
      throw new BadRequestException(
        'سرویس اعتبارسنجی کارت بانکی پیکربندی نشده است. لطفاً با پشتیبانی تماس بگیرید.',
      );
    }
    if (!status.cardMatchEnabled) {
      throw new BadRequestException(
        'اعتبارسنجی کارت بانکی در سیستم غیرفعال است.',
      );
    }
    if (status.cardMatchFailureCount >= status.cardMatchMaxFailures) {
      throw new BadRequestException(
        'سرویس اعتبارسنجی کارت موقتاً در دسترس نیست. لطفاً بعداً تلاش کنید.',
      );
    }
    throw new BadRequestException(
      'سرویس اعتبارسنجی کارت بانکی در دسترس نیست.',
    );
  }

  private async assertCardMatch(
    user: { id: string; nationalCode: string | null; birthDate: Date | null },
    cardNumber: string,
    ipAddress?: string | null,
  ): Promise<void> {
    await this.assertCardMatchInquiryAvailable();
    try {
      await this.zohal.assertCardMatchesNationalCode(
        {
          nationalCode: String(user.nationalCode),
          birthDateRaw: user.birthDate!,
          cardNumber,
        },
        user.id,
        ipAddress ?? undefined,
      );
    } catch (err) {
      if (!isZohalServiceFailure(err)) throw err;
      const { circuitOpen } = await this.zohalSettings.recordCardMatchFailure();
      if (circuitOpen) {
        throw new BadRequestException(
          'سرویس اعتبارسنجی کارت موقتاً در دسترس نیست. لطفاً بعداً تلاش کنید.',
        );
      }
      throw err;
    }
  }

  private async syncUserDefaultFields(
    userId: string,
    row: {
      bankCardNumber: string | null;
      bankCardBin: string | null;
      bankName: string | null;
      shabaNumber: string | null;
      verifiedAt: Date | null;
    },
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        bankCardNumber: row.bankCardNumber,
        bankCardBin: row.bankCardBin,
        bankName: row.bankName,
        shabaNumber: row.shabaNumber,
        financialVerifiedAt: row.verifiedAt ?? new Date(),
      },
    });
  }

  private toPublic(row: {
    id: string;
    label: string | null;
    bankCardNumber: string | null;
    bankCardBin: string | null;
    bankName: string | null;
    shabaNumber: string | null;
    isDefault: boolean;
    verifiedAt: Date | null;
  }): PublicBankAccount {
    return {
      id: row.id,
      label: row.label,
      bankName: row.bankName,
      bankCardMasked: row.bankCardNumber ? maskBankCardNumber(row.bankCardNumber) : null,
      bankCardBin: row.bankCardBin,
      shabaNumber: row.shabaNumber,
      isDefault: row.isDefault,
      verifiedAt: row.verifiedAt,
    };
  }

  private async loadUserForFinancial(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        firstName: true,
        lastName: true,
        nationalCode: true,
        birthDate: true,
        status: true,
        isVerified: true,
      },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    return user;
  }

  private assertIdentityReady(user: {
    status: import('@prisma/client').UserStatus;
    isVerified: boolean;
    nationalCode: string | null;
    birthDate: Date | null;
  }): void {
    if (!isIdentityVerified(user)) {
      throw new BadRequestException(
        'ابتدا اطلاعات هویتی خود را تکمیل و تأیید کنید.',
      );
    }
    if (!String(user.nationalCode ?? '').trim()) {
      throw new BadRequestException('کد ملی در پروفایل یافت نشد.');
    }
    if (!user.birthDate) {
      throw new BadRequestException('تاریخ تولد در پروفایل یافت نشد.');
    }
  }
}

export { isFinancialVerified, maskBankCardNumber };

