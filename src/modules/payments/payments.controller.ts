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
import {
  isKnownPaymentGatewayType,
  type PaymentGatewayName,
} from './payment-gateways.catalog';
import {
  InitiateGatewayOnlyDto,
  InitiateWalletTopupDto,
} from './dto/initiate-payment.dto';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly appSettings: AppSettingsService,
  ) {}

  @Post('checkout-sessions/:sessionId/initiate')
  @UseGuards(JwtAuthGuard)
  async initiateCheckoutSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId') sessionId: string,
    @Body() body: InitiateGatewayOnlyDto,
    @Req() req: Request,
  ) {
    const gateway = await this.resolveInitiateGateway(body?.gateway);
    return this.paymentsService.initiateCheckoutSessionPayment(
      sessionId,
      user.id,
      this.buildCallbackBase(req, gateway),
      this.buildReturnUrl(req),
      extractClientRequestMeta(req),
      gateway,
    );
  }

  @Post('orders/:orderId/initiate')
  @UseGuards(JwtAuthGuard)
  async initiateOrderPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Body() body: InitiateGatewayOnlyDto,
    @Req() req: Request,
  ) {
    const gateway = await this.resolveInitiateGateway(body?.gateway);
    return this.paymentsService.initiateOrderPayment(
      orderId,
      user.id,
      this.buildCallbackBase(req, gateway),
      this.buildReturnUrl(req),
      extractClientRequestMeta(req),
      gateway,
    );
  }

  @Post('repairs/:repairId/initiate')
  @UseGuards(JwtAuthGuard)
  async initiateRepairPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('repairId') repairId: string,
    @Body() body: InitiateGatewayOnlyDto,
    @Req() req: Request,
  ) {
    const gateway = await this.resolveInitiateGateway(body?.gateway);
    return this.paymentsService.initiateRepairPayment(
      repairId,
      user.id,
      this.buildCallbackBase(req, gateway),
      this.buildReturnUrl(req),
      extractClientRequestMeta(req),
      gateway,
    );
  }

  @Post('wallet/initiate')
  @UseGuards(JwtAuthGuard)
  async initiateWalletTopup(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: InitiateWalletTopupDto,
    @Req() req: Request,
  ) {
    const gateway = await this.resolveInitiateGateway(body?.gateway);
    return this.paymentsService.initiateWalletTopup(
      user.id,
      body.amount,
      this.buildCallbackBase(req, gateway),
      this.buildReturnUrl(req),
      extractClientRequestMeta(req),
      gateway,
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

  private async resolveInitiateGateway(
    preferred?: string,
  ): Promise<PaymentGatewayName | undefined> {
    const raw = preferred?.trim().toLowerCase();
    if (!raw) return undefined;
    if (!isKnownPaymentGatewayType(raw)) return undefined;
    return raw;
  }

  private buildCallbackBase(
    _req: Request,
    gateway?: PaymentGatewayName,
  ): string {
    const name = gateway ?? this.appSettings.getActivePaymentGateway();
    // Never trust Host / X-Forwarded-* for payment callbacks (host header poisoning).
    return this.appSettings.getPaymentGatewayConfig(name).callbackUrl;
  }

  private buildReturnUrl(req: Request): string {
    const fallback = this.appSettings.getPaymentReturnUrl();
    const origin = req.get('origin');
    if (origin && /^https?:\/\//i.test(origin)) {
      const candidate = `${origin.replace(/\/$/, '')}/payment-result`;
      return resolveSafeReturnUrl(candidate, fallback).toString();
    }
    return fallback;
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
      const m = (r as { message: unknown }).message;
      if (typeof m === 'string') return m;
      if (Array.isArray(m)) return m.map(String).join(', ');
    }
  }
  if (err instanceof Error) return err.message;
  return 'خطای پرداخت';
}
