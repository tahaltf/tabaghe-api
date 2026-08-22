import { Injectable } from '@nestjs/common';
import { BankAccountsService } from './bank-accounts.service';
import type { FinancialVerificationDto } from './dto/financial-verification.dto';

/** @deprecated use BankAccountsService — kept for backward-compatible routes */
@Injectable()
export class FinancialVerificationService {
  constructor(private readonly bankAccounts: BankAccountsService) {}

  preview(userId: string, dto: FinancialVerificationDto, ipAddress?: string | null) {
    return this.bankAccounts.preview(userId, dto, ipAddress);
  }

  async confirm(userId: string, dto: FinancialVerificationDto, ipAddress?: string | null) {
    const defaultAccount = await this.bankAccounts.getDefaultAccount(userId);
    if (defaultAccount) {
      return this.bankAccounts.update(userId, defaultAccount.id, dto, ipAddress);
    }
    return this.bankAccounts.create(userId, dto, ipAddress);
  }
}
