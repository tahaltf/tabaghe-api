import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BankAccountVerificationStatus } from '@prisma/client';
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
  verificationStatus: BankAccountVerificationStatus;
  rejectionReason: string | null;
  verifiedAt: Date | null;
};

export type AdminPendingBankAccount = {
  id: string;
  userId: string;
  userPhone: string;
  userName: string;
  bankName: string | null;
  bankCardMasked: string | null;
  shabaNumber: string | null;
  isDefault: boolean;
  createdAt: Date;
};

type FinancialVerificationResult = {
  verificationStatus: BankAccountVerificationStatus;
  shabaNumber: string | null;
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

  async listPendingForAdmin(): Promise<AdminPendingBankAccount[]> {
    const rows = await this.prisma.userBankAccount.findMany({
      where: {
        deletedAt: null,
        verificationStatus: BankAccountVerificationStatus.PENDING,
      },
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          select: { phone: true, firstName: true, lastName: true },
        },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      userPhone: row.user.phone,
      userName:
        `${String(row.user.firstName ?? '').trim()} ${String(row.user.lastName ?? '').trim()}`.trim() ||
        row.user.phone,
      bankName: row.bankName,
      bankCardMasked: row.bankCardNumber
        ? maskBankCardNumber(row.bankCardNumber)
        : null,
      shabaNumber: row.shabaNumber,
      isDefault: row.isDefault,
      createdAt: row.createdAt,
    }));
  }

  async approveBankAccount(
    accountId: string,
    adminId: string,
    ipAddress?: string | null,
  ): Promise<PublicBankAccount> {
    const row = await this.prisma.userBankAccount.findFirst({
      where: { id: accountId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('حساب بانکی یافت نشد');
    if (row.verificationStatus !== BankAccountVerificationStatus.PENDING) {
      throw new BadRequestException('این حساب در وضعیت انتظار نیست.');
    }

    let shabaNumber = row.shabaNumber;
    if (
      !shabaNumber &&
      row.bankCardNumber &&
      (await this.zohalSettings.isCardMatchActive())
    ) {
      try {
        const { iban } = await this.zohal.convertCardToIban(
          row.bankCardNumber,
          row.userId,
          ipAddress ?? undefined,
        );
        shabaNumber = iban;
      } catch {
        // admin can approve without shaba
      }
    }

    const updated = await this.prisma.userBankAccount.update({
      where: { id: accountId },
      data: {
        verificationStatus: BankAccountVerificationStatus.APPROVED,
        rejectionReason: null,
        shabaNumber,
        verifiedAt: new Date(),
        reviewedAt: new Date(),
        reviewedByAdminId: adminId,
      },
    });
    if (updated.isDefault) {
      await this.syncUserDefaultFields(updated.userId, updated);
    }
    return this.toPublic(updated);
  }

  async rejectBankAccount(
    accountId: string,
    adminId: string,
    reason: string,
  ): Promise<PublicBankAccount> {
    const row = await this.prisma.userBankAccount.findFirst({
      where: { id: accountId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('حساب بانکی یافت نشد');
    if (row.verificationStatus !== BankAccountVerificationStatus.PENDING) {
      throw new BadRequestException('این حساب در وضعیت انتظار نیست.');
    }

    const trimmedReason = reason.trim() || 'مدارک/اطلاعات حساب بانکی تأیید نشد.';
    const wasDefault = row.isDefault;

    const updated = await this.prisma.userBankAccount.update({
      where: { id: accountId },
      data: {
        verificationStatus: BankAccountVerificationStatus.REJECTED,
        rejectionReason: trimmedReason,
        isDefault: false,
        reviewedAt: new Date(),
        reviewedByAdminId: adminId,
      },
    });

    if (wasDefault) {
      await this.promoteNextDefault(updated.userId);
    }

    return this.toPublic(updated);
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
    const verification = await this.runFinancialVerification(
      user,
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
      shabaNumber: verification.shabaNumber,
      shabaDisplay: verification.shabaNumber
        ? formatShabaDisplay(verification.shabaNumber)
        : null,
      hasCard: true,
      hasShaba: !!verification.shabaNumber,
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
    const verification = await this.runFinancialVerification(
      user,
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
        shabaNumber: verification.shabaNumber,
        isDefault: isDefault || count === 0,
        verificationStatus: verification.verificationStatus,
        verifiedAt: verification.verifiedAt,
      },
    });
    if (row.isDefault && row.verificationStatus === BankAccountVerificationStatus.APPROVED) {
      await this.syncUserDefaultFields(userId, row);
    }
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

    const verification = await this.runFinancialVerification(
      user,
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
        shabaNumber: verification.shabaNumber,
        verificationStatus: verification.verificationStatus,
        verifiedAt: verification.verifiedAt,
        rejectionReason: null,
        reviewedAt: null,
        reviewedByAdminId: null,
      },
    });
    if (
      row.isDefault &&
      row.verificationStatus === BankAccountVerificationStatus.APPROVED
    ) {
      await this.syncUserDefaultFields(userId, row);
    }
    return this.toPublic(row);
  }

  async remove(userId: string, accountId: string): Promise<void> {
    const existing = await this.findActiveAccount(userId, accountId);
    await this.prisma.userBankAccount.update({
      where: { id: accountId },
      data: { deletedAt: new Date(), isDefault: false },
    });
    if (existing.isDefault) {
      await this.promoteNextDefault(userId);
    }
  }

  async setDefault(userId: string, accountId: string): Promise<PublicBankAccount> {
    const account = await this.findActiveAccount(userId, accountId);
    if (account.verificationStatus === BankAccountVerificationStatus.REJECTED) {
      throw new BadRequestException('حساب رد‌شده را نمی‌توان پیش‌فرض کرد.');
    }
    await this.clearDefaultFlags(userId);
    const updated = await this.prisma.userBankAccount.update({
      where: { id: accountId },
      data: { isDefault: true },
    });
    if (updated.verificationStatus === BankAccountVerificationStatus.APPROVED) {
      await this.syncUserDefaultFields(userId, updated);
    }
    return this.toPublic(updated);
  }

  async getDefaultAccount(userId: string) {
    return this.prisma.userBankAccount.findFirst({
      where: {
        ...this.activeWhere(userId),
        isDefault: true,
        verificationStatus: BankAccountVerificationStatus.APPROVED,
      },
    });
  }

  async getAccountForWithdraw(userId: string, accountId: string) {
    const row = await this.prisma.userBankAccount.findFirst({
      where: {
        id: accountId,
        userId,
        deletedAt: null,
        verificationStatus: BankAccountVerificationStatus.APPROVED,
      },
    });
    if (!row) {
      throw new BadRequestException('حساب بانکی تأیید‌شده‌ای انتخاب نشده است.');
    }
    return row;
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
        verificationStatus: {
          in: [
            BankAccountVerificationStatus.PENDING,
            BankAccountVerificationStatus.APPROVED,
          ],
        },
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

    const verification = await this.runFinancialVerification(
      user,
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
        shabaNumber: verification.shabaNumber ?? deletedRow.shabaNumber,
        isDefault: isDefault || activeCount === 0,
        verificationStatus: verification.verificationStatus,
        verifiedAt: verification.verifiedAt,
        rejectionReason: null,
        reviewedAt: null,
        reviewedByAdminId: null,
      },
    });
    if (row.isDefault && row.verificationStatus === BankAccountVerificationStatus.APPROVED) {
      await this.syncUserDefaultFields(userId, row);
    }
    return this.toPublic(row);
  }

  private async promoteNextDefault(userId: string): Promise<void> {
    const nextApproved = await this.prisma.userBankAccount.findFirst({
      where: {
        ...this.activeWhere(userId),
        verificationStatus: BankAccountVerificationStatus.APPROVED,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (nextApproved) {
      await this.prisma.userBankAccount.update({
        where: { id: nextApproved.id },
        data: { isDefault: true },
      });
      await this.syncUserDefaultFields(userId, nextApproved);
      return;
    }

    const nextAny = await this.prisma.userBankAccount.findFirst({
      where: this.activeWhere(userId),
      orderBy: { createdAt: 'desc' },
    });
    if (nextAny) {
      await this.prisma.userBankAccount.update({
        where: { id: nextAny.id },
        data: { isDefault: true },
      });
      return;
    }

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

  private async runFinancialVerification(
    user: {
      id: string;
      nationalCode: string | null;
      birthDate: Date | null;
    },
    cardNumber: string,
    ipAddress?: string | null,
  ): Promise<FinancialVerificationResult> {
    const restriction = await this.inquiryRestrictions.getSnapshot(user.id);
    if (restriction.inquiryBlocked) {
      throw new BadRequestException(
        'دسترسی استعلام شما محدود شده است. لطفاً با پشتیبانی تماس بگیرید.',
      );
    }
    if (restriction.manualEntryOnly) {
      return this.pendingVerification(null);
    }
    if (!(await this.zohalSettings.isCardMatchActive())) {
      return this.pendingVerification(null);
    }
    // Already-verified users may lack birthDate (manual/admin KYC); send to admin review.
    if (!user.birthDate) {
      return this.pendingVerification(null);
    }

    try {
      await this.zohal.assertCardMatchesNationalCode(
        {
          nationalCode: String(user.nationalCode),
          birthDateRaw: user.birthDate,
          cardNumber,
        },
        user.id,
        ipAddress ?? undefined,
      );
    } catch (err) {
      if (isZohalServiceFailure(err)) {
        await this.zohalSettings.recordCardMatchFailure();
        return this.pendingVerification(null);
      }
      throw err;
    }

    let shabaNumber: string | null = null;
    try {
      const { iban } = await this.zohal.convertCardToIban(
        cardNumber,
        user.id,
        ipAddress ?? undefined,
      );
      shabaNumber = iban;
    } catch (err) {
      if (isZohalServiceFailure(err)) {
        return this.approvedVerification(null);
      }
      throw err;
    }

    return this.approvedVerification(shabaNumber);
  }

  private pendingVerification(shabaNumber: string | null): FinancialVerificationResult {
    return {
      verificationStatus: BankAccountVerificationStatus.PENDING,
      shabaNumber,
      verifiedAt: null,
    };
  }

  private approvedVerification(shabaNumber: string | null): FinancialVerificationResult {
    return {
      verificationStatus: BankAccountVerificationStatus.APPROVED,
      shabaNumber,
      verifiedAt: new Date(),
    };
  }

  private async syncUserDefaultFields(
    userId: string,
    row: {
      bankCardNumber: string | null;
      bankCardBin: string | null;
      bankName: string | null;
      shabaNumber: string | null;
      verifiedAt: Date | null;
      verificationStatus?: BankAccountVerificationStatus;
    },
  ): Promise<void> {
    if (row.verificationStatus && row.verificationStatus !== BankAccountVerificationStatus.APPROVED) {
      return;
    }
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
    verificationStatus: BankAccountVerificationStatus;
    rejectionReason: string | null;
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
      verificationStatus: row.verificationStatus,
      rejectionReason: row.rejectionReason,
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
  }
}

export { isFinancialVerified, maskBankCardNumber };
