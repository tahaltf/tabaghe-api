import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../shared/contracts/auth';
import { AppSettingsService } from '../../shared/settings/app-settings.service';
import { resolveSafeReturnUrl } from '../../common/security/safe-return-url.util';
import { extractClientRequestMeta } from '../../common/http/client-ip.util';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly appSettings: AppSettingsService,
  ) {}

  @Post('checkout-sessions/:sessionId/initiate')
  @UseGuards(JwtAuthGuard)
  initiateCheckoutSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId') sessionId: string,
    @Req() req: Request,
  ) {
    return this.paymentsService.initiateCheckoutSessionPayment(
      sessionId,
      user.id,
      this.buildCallbackBase(req),
      this.buildReturnUrl(req),
      extractClientRequestMeta(req),
    );
  }

  @Post('orders/:orderId/initiate')
  @UseGuards(JwtAuthGuard)
  initiateOrderPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Req() req: Request,
  ) {
    return this.paymentsService.initiateOrderPayment(
      orderId,
      user.id,
      this.buildCallbackBase(req),
      this.buildReturnUrl(req),
      extractClientRequestMeta(req),
    );
  }

  @Post('repairs/:repairId/initiate')
  @UseGuards(JwtAuthGuard)
  initiateRepairPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('repairId') repairId: string,
    @Req() req: Request,
  ) {
    return this.paymentsService.initiateRepairPayment(
      repairId,
      user.id,
      this.buildCallbackBase(req),
      this.buildReturnUrl(req),
      extractClientRequestMeta(req),
    );
  }

  @Post('wallet/initiate')
  @UseGuards(JwtAuthGuard)
  initiateWalletTopup(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { amount: number },
    @Req() req: Request,
  ) {
    return this.paymentsService.initiateWalletTopup(
      user.id,
      body.amount,
      this.buildCallbackBase(req),
      this.buildReturnUrl(req),
      extractClientRequestMeta(req),
    );
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
      const target = this.resolveReturnTarget(query);
      if (result.orderId)
        target.searchParams.set('orderId', String(result.orderId));
      if (result.repairId)
        target.searchParams.set('repairId', String(result.repairId));
      if (result.kind) target.searchParams.set('kind', String(result.kind));
      target.searchParams.set('result', String(result.result));
      target.searchParams.set('ok', String(result.ok));
      if (result.authority)
        target.searchParams.set('authority', String(result.authority));
      if (result.refId) target.searchParams.set('refId', String(result.refId));
      if (result.message)
        target.searchParams.set('message', String(result.message));
      return res.redirect(302, target.toString());
    } catch (err: unknown) {
      const target = this.resolveReturnTarget(query);
      target.searchParams.set('result', 'ERROR');
      target.searchParams.set('ok', 'false');
      target.searchParams.set(
        'message',
        paymentCallbackErrorMessage(err).slice(0, 500),
      );
      return res.redirect(302, target.toString());
    }
  }

  private buildCallbackBase(req: Request): string {
    const protoHeader = req.headers['x-forwarded-proto'];
    const hostHeader = req.headers['x-forwarded-host'];
    const protocol =
      (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader) ||
      req.protocol ||
      'https';
    const host =
      (Array.isArray(hostHeader) ? hostHeader[0] : hostHeader) ||
      req.get('host');
    if (!host) return this.appSettings.getPaymentGatewayConfig().callbackUrl;
    return `${protocol}://${host}/api/v1/payments/callback/zibal`;
  }

  private buildReturnUrl(req: Request): string {
    const origin = req.get('origin');
    if (origin && /^https?:\/\//i.test(origin)) {
      return `${origin.replace(/\/$/, '')}/payment-result`;
    }
    return this.appSettings.getPaymentReturnUrl();
  }

  private resolveReturnTarget(query: Record<string, unknown>): URL {
    const fallback = this.appSettings.getPaymentReturnUrl();
    return resolveSafeReturnUrl(String(query.returnUrl ?? ''), fallback);
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
