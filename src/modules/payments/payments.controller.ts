import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../shared/contracts/auth';
import { AppSettingsService } from '../../shared/settings/app-settings.service';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly appSettings: AppSettingsService,
  ) {}

  @Post('orders/:orderId/initiate')
  @UseGuards(JwtAuthGuard)
  initiateOrderPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') orderId: string,
  ) {
    return this.paymentsService.initiateOrderPayment(orderId, user.id);
  }

  @Post('repairs/:repairId/initiate')
  @UseGuards(JwtAuthGuard)
  initiateRepairPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('repairId') repairId: string,
  ) {
    return this.paymentsService.initiateRepairPayment(repairId, user.id);
  }

  @Post('wallet/initiate')
  @UseGuards(JwtAuthGuard)
  initiateWalletTopup(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { amount: number },
  ) {
    return this.paymentsService.initiateWalletTopup(user.id, body.amount);
  }

  @Get('callback/:gateway')
  async gatewayCallback(
    @Param('gateway') gateway: string,
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ) {
    try {
      const result: any = await this.paymentsService.processGatewayCallback(
        gateway,
        query,
      );
      const target = new URL(this.appSettings.getPaymentReturnUrl());
      if (result.orderId) target.searchParams.set('orderId', String(result.orderId));
      if (result.repairId) target.searchParams.set('repairId', String(result.repairId));
      if (result.kind) target.searchParams.set('kind', String(result.kind));
      target.searchParams.set('result', String(result.result));
      target.searchParams.set('ok', String(result.ok));
      if (result.authority) target.searchParams.set('authority', String(result.authority));
      if (result.refId) target.searchParams.set('refId', String(result.refId));
      if (result.message) target.searchParams.set('message', String(result.message));
      return res.redirect(302, target.toString());
    } catch (err: unknown) {
      const target = new URL(this.appSettings.getPaymentReturnUrl());
      target.searchParams.set('result', 'ERROR');
      target.searchParams.set('ok', 'false');
      target.searchParams.set(
        'message',
        paymentCallbackErrorMessage(err).slice(0, 500),
      );
      return res.redirect(302, target.toString());
    }
  }
}

function paymentCallbackErrorMessage(err: unknown): string {
  if (err instanceof HttpException) {
    const r = err.getResponse();
    if (typeof r === 'string') return r;
    if (r && typeof r === 'object' && 'message' in r) {
      const m = (r as { message?: unknown }).message;
      if (Array.isArray(m)) return m.filter(Boolean).join('، ');
      if (typeof m === 'string') return m;
    }
  }
  if (err instanceof Error) return err.message;
  return 'خطا در پردازش بازگشت از درگاه';
}
