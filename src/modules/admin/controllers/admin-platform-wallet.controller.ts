import { BadRequestException, Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { PlatformCreditUserDto, PlatformProfitWithdrawDto } from '../dto/admin-platform-wallet.dto';
import { AdminPlatformWalletService } from '../services/admin-platform-wallet.service';

@Controller('admin/platform-wallet')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminPlatformWalletController {
  constructor(private readonly service: AdminPlatformWalletService) {}

  @Get('summary')
  summary() {
    return this.service.getSummary();
  }

  @Patch('withdraw-profit')
  withdrawProfit(@Body() dto: PlatformProfitWithdrawDto) {
    return this.service.withdrawProfit(dto.amount, dto.note);
  }

  @Patch('credit-user')
  creditUser(@Body() dto: PlatformCreditUserDto) {
    return this.service.creditUser(dto.userId, dto.amount, dto.source, dto.note);
  }

  @Get('history')
  history(
    @Query('range') range?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('side') side?: string,
    @Query('source') source?: string,
  ) {
    const r = (range ?? '30d') as 'today' | '7d' | '30d' | '90d' | '365d' | 'all';
    const allowed = new Set(['today', '7d', '30d', '90d', '365d', 'all']);
    if (!allowed.has(r)) {
      throw new BadRequestException('بازه تاریخچه سود نامعتبر است');
    }
    const sideNormalized = (side ?? 'ALL').toUpperCase();
    if (!['ALL', 'IN', 'OUT'].includes(sideNormalized)) {
      throw new BadRequestException('فیلتر نوع تراکنش نامعتبر است');
    }
    return this.service.getHistory({
      range: r,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      search,
      side: sideNormalized as 'ALL' | 'IN' | 'OUT',
      source,
    });
  }
}

