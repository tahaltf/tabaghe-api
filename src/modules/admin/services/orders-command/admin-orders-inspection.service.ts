import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ExchangeOfferStatus,
  ListingStatus,
  ListingType,
  NotificationType,
  OrderStatus,
  Prisma,
  UserRole,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';

import { FinalizeExchangeHubInspectionDto, RejectExchangeFakeShipmentDto } from '../../dto/admin-order.dto';
import { AppSettingsService } from '../../../../shared/settings/app-settings.service';
import { readPositiveIntSetting } from '../../../../common/system-settings/numeric-setting.util';
import { FeeCalculatorService } from '../../../fees/fee-calculator.service';
import {
  OrderReputationService,
  TRADE_REPUTATION_PENALTY_DELTA,
} from '../../../orders/order-reputation.service';
import { WalletService } from '../../../wallet/wallet.service';
import { ListingCommandService } from '../../../listing/services/listing-command.service';
import {
  buildOrderTicketSubject,
  formatTicketMessageBody,
} from '../../../../common/ticket-message.util';
import { EXCHANGE_INSPECTION_TICKET_TEMPLATE_KEYS } from '../admin-orders.constants';
import { AdminOrdersNotifyService } from './admin-orders-notify.service';
import { ORDER_STATUS_FINANCIAL_SETTLEMENT_LABEL_FA } from '../../../../common/order/order-status-labels.util';
import {
  applyExchangeFinancialSettlement,
  buildExchangeFinancialSettlementNotifyMessage,
  buildExchangeFinancialSettlementOrderNote,
  buildExchangeFinancialSettlementTicketBody,
  buildExchangeFinancialSettlementTicketNotifyMessage,
  EXCHANGE_FINANCIAL_SETTLEMENT_NOTIFY_TITLE,
  EXCHANGE_FINANCIAL_SETTLEMENT_TICKET_SUBJECT,
  resolveExchangeSurplusReceivableBases,
} from '../../../../common/order/exchange-financial-settlement-messaging.util';
import { buildExchangeSettlementWalletMeta } from '../../../../common/wallet/exchange-settlement-wallet-meta.util';

@Injectable()
export class AdminOrdersInspectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appSettings: AppSettingsService,
    private readonly feeCalculator: FeeCalculatorService,
    private readonly orderReputation: OrderReputationService,
    private readonly walletService: WalletService,
    private readonly listingCommand: ListingCommandService,
    private readonly notify: AdminOrdersNotifyService,
  ) {}

  private buildExchangeReturnInspectionTicketMessage(params: {
    role: 'seller' | 'buyer';
    orderId: string;
    listingTitle: string;
    listingFailed: boolean;
    offerFailed: boolean;
    ownNote: string | null;
    refundAmount: number;
    templates?: Partial<Record<(typeof EXCHANGE_INSPECTION_TICKET_TEMPLATE_KEYS)[keyof typeof EXCHANGE_INSPECTION_TICKET_TEMPLATE_KEYS], string>>;
  }): string {
    const shortId = params.orderId.slice(-6);
    const penalty = TRADE_REPUTATION_PENALTY_DELTA;
    const isSeller = params.role === 'seller';
    const ownFailed = isSeller ? params.listingFailed : params.offerFailed;
    const otherFailed = isSeller ? params.offerFailed : params.listingFailed;
    const bothFailed = params.listingFailed && params.offerFailed;
    const refundFa =
      params.refundAmount > 0
        ? params.refundAmount.toLocaleString('fa-IR')
        : null;

    const fallbackLines: string[] = [
      `نتیجه کارشناسی معاوضه #${shortId} برای آگهی «${params.listingTitle}»`,
      '',
      '۱) وضعیت معامله',
    ];

    if (bothFailed) {
      fallbackLines.push(
        '- هر دو کالا در کارشناسی رد شدند و معامله لغو شد.',
        '- کالای شما از هاب به آدرس ثبت‌شده مرجوع می‌شود.',
      );
    } else if (ownFailed) {
      fallbackLines.push(
        '- کالای ارسالی شما رد شد و معامله لغو شد.',
        '- کالای شما از هاب به آدرس ثبت‌شده مرجوع می‌شود.',
      );
    } else if (otherFailed) {
      fallbackLines.push(
        '- کالای طرف مقابل رد شد و معامله لغو شد.',
        '- کالای شما در کارشناسی تایید شد و از هاب مرجوع می‌شود.',
      );
    } else {
      fallbackLines.push('- معامله لغو شد و مرجوع کالا در حال انجام است.');
    }

    fallbackLines.push('', '۲) نتیجه مالی');

    if (bothFailed) {
      fallbackLines.push(
        '- طبق سیاست مالی، هزینه کارشناسی در حالت رد دوطرفه مسترد نمی‌شود.',
      );
    } else if (ownFailed) {
      fallbackLines.push(
        '- هزینه کارشناسی شما به‌دلیل رد کالا مسترد نمی‌شود.',
      );
    } else if (otherFailed) {
      fallbackLines.push(
        '- به‌دلیل تایید کالای شما و لغو معامله، سهم پرداختی شما به‌طور کامل بازگردانده شد.',
        '- مبلغ دلجویی از سهم هزینه کارشناسی طرف ردشده نیز به کیف پول شما اضافه شد.',
      );
    }

    if (refundFa) {
      fallbackLines.push(`- مبلغ واریزی به کیف پول شما: ${refundFa} تومان.`);
    } else {
      fallbackLines.push(
        '- در حال حاضر مبلغی به کیف پول شما واریز نشد (در صورتی که پرداختی ثبت نشده باشد).',
      );
    }

    fallbackLines.push('', '۳) امتیاز و اقدام بعدی');
    if (ownFailed || bothFailed) {
      fallbackLines.push(`- امتیاز معاملاتی شما ${penalty} واحد کاهش یافت.`);
    } else {
      fallbackLines.push('- برای شما کسر امتیاز اعمال نشده است.');
    }
    if (params.ownNote?.trim()) {
      fallbackLines.push(`- توضیح کارشناسی کالای شما: ${params.ownNote.trim()}`);
    }
    if (isSeller && otherFailed && !ownFailed) {
      fallbackLines.push(
        '- کالای شما تایید شده است؛ آگهی به‌صورت خودکار رد نشده.',
        '- در صفحه جزئیات همین سفارش می‌توانید انتخاب کنید آگهی دوباره روی سایت نمایش داده شود یا خیر.',
      );
    }
    fallbackLines.push(
      '- پس از ثبت کد رهگیری مرجوعی توسط هاب، جزئیات در سفارش نمایش داده می‌شود.',
      '- در صورت نیاز، پاسخ همین تیکت را ارسال کنید تا پشتیبانی پیگیری کند.',
    );

    const selectedTemplate = bothFailed
      ? params.templates?.[EXCHANGE_INSPECTION_TICKET_TEMPLATE_KEYS.BOTH_FAILED]
      : ownFailed
        ? params.templates?.[EXCHANGE_INSPECTION_TICKET_TEMPLATE_KEYS.OWN_FAILED]
        : otherFailed
          ? params.templates?.[EXCHANGE_INSPECTION_TICKET_TEMPLATE_KEYS.OTHER_FAILED]
          : '';
    const template = String(selectedTemplate ?? '').trim();
    if (template) {
      return this.renderTemplateString(template, {
        orderShortId: shortId,
        listingTitle: params.listingTitle,
        refundAmount: refundFa ?? '0',
        penaltyDelta: String(penalty),
        ownNote: params.ownNote?.trim() || '-',
      });
    }

    return formatTicketMessageBody(
      fallbackLines.filter((line): line is string => Boolean(line)),
    );
  }

  private renderTemplateString(
    template: string,
    values: Record<string, string>,
  ): string {
    return template.replace(/\{\{(\w+)\}\}/g, (full, key: string) => {
      const normalized = String(key || '').trim();
      if (!normalized) return full;
      return values[normalized] ?? full;
    });
  }

  private async readExchangeInspectionTicketTemplates(): Promise<
    Partial<
      Record<
        (typeof EXCHANGE_INSPECTION_TICKET_TEMPLATE_KEYS)[keyof typeof EXCHANGE_INSPECTION_TICKET_TEMPLATE_KEYS],
        string
      >
    >
  > {
    const keys = Object.values(EXCHANGE_INSPECTION_TICKET_TEMPLATE_KEYS);
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: keys } },
      select: { key: true, value: true },
    });
    return rows.reduce(
      (acc, row) => {
        const key =
          row.key as (typeof EXCHANGE_INSPECTION_TICKET_TEMPLATE_KEYS)[keyof typeof EXCHANGE_INSPECTION_TICKET_TEMPLATE_KEYS];
        acc[key] = row.value;
        return acc;
      },
      {} as Partial<
        Record<
          (typeof EXCHANGE_INSPECTION_TICKET_TEMPLATE_KEYS)[keyof typeof EXCHANGE_INSPECTION_TICKET_TEMPLATE_KEYS],
          string
        >
      >,
    );
  }

  /**
   * معاوضه: ثبت نتیجه کارشناسی جداگانه برای هر کالا + انتخاب یکی از سه مسیر نهایی:
   * ارسال به مقصد | مرجوع هر دو | ادامه با توافق مالی (مصالحه در همان صفحه ادمین).
   */
  async finalizeExchangeHubInspection(
    id: string,
    dto: FinalizeExchangeHubInspectionDto,
  ) {
    const existing = await this.prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        status: true,
        exchangeHubInspection: true,
        verificationFee: true,
        totalAmount: true,
        sellerRevenue: true,
        exchangeOfferId: true,
        buyerId: true,
        sellerId: true,
        tradeReputationAt: true,
        trackingCode: true,
        sellerTrackingCode: true,
        packagingVideo: true,
        buyerPackagingVideo: true,
        listing: { select: { id: true, title: true } },
      },
    });
    if (!existing) throw new NotFoundException('سفارش یافت نشد');
    if (existing.type !== 'EXCHANGE') {
      throw new BadRequestException(
        'این عملیات فقط برای سفارش معاوضه مجاز است',
      );
    }
    if (existing.status !== OrderStatus.CHECKING_AT_HUB) {
      throw new BadRequestException(
        'سفارش باید در وضعیت «در حال بررسی در هاب» باشد',
      );
    }

    const prevInspection =
      (existing.exchangeHubInspection as Record<string, unknown> | null) ??
      {};
    if (
      prevInspection['skipInspection'] ||
      prevInspection['singleSideNoShipmentTimeout']
    ) {
      throw new BadRequestException(
        'این معامله بدون کارشناسی (به‌دلیل عدم ارسال در مهلت) بسته شده است',
      );
    }
    if (
      !existing.trackingCode?.trim() ||
      !existing.sellerTrackingCode?.trim()
    ) {
      throw new BadRequestException(
        'تا زمانی که هر دو طرف مرسوله را به هاب ارسال نکرده‌اند، ثبت نتیجه کارشناسی مجاز نیست',
      );
    }

    const itemNeedsNote = (v: string) =>
      v === 'FAIL' || v === 'PASS_WITH_SETTLEMENT';
    if (itemNeedsNote(dto.listingItem) && !dto.listingNote?.trim()) {
      throw new BadRequestException(
        'برای کالای آگهی، با این نتیجه ثبت توضیح الزامی است',
      );
    }
    if (itemNeedsNote(dto.offerItem) && !dto.offerNote?.trim()) {
      throw new BadRequestException(
        'برای کالای پیشنهاد، با این نتیجه ثبت توضیح الزامی است',
      );
    }

    const resolution = dto.resolution;
    const listingFailed = dto.listingItem === 'FAIL';
    const offerFailed = dto.offerItem === 'FAIL';
    const hasAnyFail = listingFailed || offerFailed;

    if (resolution === 'SHIP_TO_DESTINATIONS') {
      if (dto.listingItem !== 'PASS' || dto.offerItem !== 'PASS') {
        throw new BadRequestException(
          'برای «ارسال به مقصد»، هر دو کالا باید «تایید سلامت / بدون ایراد» باشند',
        );
      }
    } else if (resolution === 'RETURN_BOTH_TO_SENDERS') {
      if (!hasAnyFail) {
        throw new BadRequestException(
          'برای «مرجوع هر دو کالا»، حداقل یکی از کالاها باید «رد کارشناسی» باشد',
        );
      }
    } else if (resolution === 'FINANCIAL_SETTLEMENT_THEN_SHIP') {
      if (dto.listingItem === 'FAIL' || dto.offerItem === 'FAIL') {
        throw new BadRequestException(
          'در مسیر «توافق مالی و ادامه»، نباید کالایی در وضعیت «رد کامل» باشد',
        );
      }
      if (
        dto.listingItem !== 'PASS_WITH_SETTLEMENT' &&
        dto.offerItem !== 'PASS_WITH_SETTLEMENT'
      ) {
        throw new BadRequestException(
          'برای «توافق مالی و ادامه»، حداقل یکی از کالاها باید «تایید مشروط / نیاز به اصلاح مالی» باشد؛ اگر هر دو بدون ایرادند از «ارسال به مقصد» استفاده کنید',
        );
      }
    }
    if (hasAnyFail && resolution !== 'RETURN_BOTH_TO_SENDERS') {
      throw new BadRequestException(
        'با رد شدن حتی یکی از کالاها، معامله باید کنسل شود و مسیر «مرجوع هر دو کالا» انتخاب شود',
      );
    }
    if (
      hasAnyFail &&
      (dto.listingItem === 'PASS_WITH_SETTLEMENT' ||
        dto.offerItem === 'PASS_WITH_SETTLEMENT')
    ) {
      throw new BadRequestException(
        'وقتی حتی یکی از کالاها رد شده باشد، اصلاح مالی غیرفعال است و نتیجه کالای دیگر باید فقط «تایید سلامت» یا «رد کارشناسی» باشد',
      );
    }

    // در سیاست جدید، هر کالایی که رد شود، جریمه همان طرف به‌صورت خودکار اعمال می‌شود.
    const listingApplyPenalty = listingFailed;
    const offerApplyPenalty = offerFailed;

    const inspectionBase = {
      listingItem: dto.listingItem,
      offerItem: dto.offerItem,
      listingNote: dto.listingNote?.trim() || null,
      offerNote: dto.offerNote?.trim() || null,
      listingApplyPenalty,
      offerApplyPenalty,
      resolution,
      finalizedAt: new Date().toISOString(),
    };
    const mergeInspectionPayload = (extra: Record<string, unknown>) => ({
      ...prevInspection,
      ...inspectionBase,
      ...extra,
    });

    const itemLabel = (v: string) =>
      v === 'PASS'
        ? 'تایید سلامت (بدون ایراد)'
        : v === 'FAIL'
          ? 'رد کارشناسی'
          : 'تایید مشروط / نیاز به اصلاح مالی';

    const apiUrl = this.appSettings.getApiUrl().replace(/\/$/, '');
    const listingUrl = `${apiUrl}/listing/${existing.listing.id}`;
    const packagingVideoUrl = existing.packagingVideo
      ? `${apiUrl}/uploads/orders/videos/${existing.packagingVideo}`
      : null;
    const buyerPackagingVideoUrl = existing.buyerPackagingVideo
      ? `${apiUrl}/uploads/orders/videos/${existing.buyerPackagingVideo}`
      : null;

    if (resolution === 'SHIP_TO_DESTINATIONS') {
      const inspectionPayload = mergeInspectionPayload({
        awaitingFinanceSettlement: false,
      });
      const updated = await this.prisma.order.update({
        where: { id },
        data: {
          status: OrderStatus.VERIFIED_AT_HUB,
          exchangeHubInspection: inspectionPayload as Prisma.InputJsonValue,
        },
      });
      await this.notify.notifyParties(
        existing.buyerId,
        existing.sellerId,
        id,
        OrderStatus.VERIFIED_AT_HUB,
        'نتیجه کارشناسی: هر دو کالا تایید شد و برای ارسال به مقصد نهایی آماده می‌شود.',
      );
      return updated;
    }

    if (resolution === 'FINANCIAL_SETTLEMENT_THEN_SHIP') {
      const listingSettlementAmount =
        dto.listingItem === 'PASS_WITH_SETTLEMENT'
          ? Number(dto.listingSettlementAmount || 0)
          : 0;
      const offerSettlementAmount =
        dto.offerItem === 'PASS_WITH_SETTLEMENT'
          ? Number(dto.offerSettlementAmount || 0)
          : 0;
      if (
        dto.listingItem === 'PASS_WITH_SETTLEMENT' &&
        listingSettlementAmount <= 0
      ) {
        throw new BadRequestException(
          'برای کالای آگهی با اصلاح مالی، مبلغ اصلاح الزامی است',
        );
      }
      if (
        dto.offerItem === 'PASS_WITH_SETTLEMENT' &&
        offerSettlementAmount <= 0
      ) {
        throw new BadRequestException(
          'برای کالای پیشنهاد با اصلاح مالی، مبلغ اصلاح الزامی است',
        );
      }
      const listingSettlementDirection =
        dto.listingItem === 'PASS_WITH_SETTLEMENT'
          ? dto.listingSettlementDirection || 'DEBIT'
          : null;
      const offerSettlementDirection =
        dto.offerItem === 'PASS_WITH_SETTLEMENT'
          ? dto.offerSettlementDirection || 'DEBIT'
          : null;
      if (
        (dto.listingItem === 'PASS_WITH_SETTLEMENT' &&
          listingSettlementDirection !== 'DEBIT') ||
        (dto.offerItem === 'PASS_WITH_SETTLEMENT' &&
          offerSettlementDirection !== 'DEBIT')
      ) {
        throw new BadRequestException(
          'در معاوضه، اصلاح مالی فقط کاهشی است و جهت CREDIT مجاز نیست',
        );
      }
      const exchangeOfferForSummary = existing.exchangeOfferId
        ? await this.prisma.exchangeOffer.findUnique({
            where: { id: existing.exchangeOfferId },
            select: { extraPayment: true, isPayerMe: true },
          })
        : null;
      if (!exchangeOfferForSummary) {
        throw new BadRequestException(
          'اطلاعات پیشنهاد معاوضه برای محاسبه تسویه مالی یافت نشد',
        );
      }
      const surplusBases = resolveExchangeSurplusReceivableBases(
        exchangeOfferForSummary,
      );
      const sellerBefore = surplusBases.sellerBefore;
      const buyerBefore = surplusBases.buyerBefore;
      // اصلاح مالی همیشه "کاهشی" است:
      // listingSettlementAmount => کاهش از فروشنده و افزایش به خریدار
      // offerSettlementAmount => کاهش از خریدار و افزایش به فروشنده
      const { sellerAfter, buyerAfter } = applyExchangeFinancialSettlement(
        surplusBases,
        { listingSettlementAmount, offerSettlementAmount },
      );
      const settlementSummary = {
        sellerAdjustment: {
          before: sellerBefore,
          after: sellerAfter,
          delta: sellerAfter - sellerBefore,
        },
        buyerAdjustment: {
          before: buyerBefore,
          after: buyerAfter,
          delta: buyerAfter - buyerBefore,
        },
        listingAdjustment: listingSettlementAmount
          ? {
              amount: listingSettlementAmount,
              direction: listingSettlementDirection,
              deltaToSeller: -listingSettlementAmount,
            }
          : null,
        offerAdjustment: offerSettlementAmount
          ? {
              amount: offerSettlementAmount,
              direction: offerSettlementDirection,
              deltaToBuyer: -offerSettlementAmount,
            }
          : null,
        reason:
          [dto.listingNote?.trim(), dto.offerNote?.trim()]
            .filter(Boolean)
            .join(' | ') || null,
        settledAt: new Date().toISOString(),
      };
      const inspectionPayload = mergeInspectionPayload({
        awaitingFinanceSettlement: false,
        pendingFinancialSettlement: null,
        financialSettlementSummary: settlementSummary,
        financeSettledAt: new Date().toISOString(),
      });
      const settlementMessagingInput = {
        listingItem: dto.listingItem,
        offerItem: dto.offerItem,
        listingNote: dto.listingNote?.trim() || null,
        offerNote: dto.offerNote?.trim() || null,
        listingSettlementAmount,
        offerSettlementAmount,
      };
      const summaryText = buildExchangeFinancialSettlementOrderNote(
        settlementMessagingInput,
      );

      const updated = await this.prisma.$transaction(async (tx) => {
        const offer = existing.exchangeOfferId
          ? await tx.exchangeOffer.findUnique({
              where: { id: existing.exchangeOfferId },
              select: { extraPayment: true, isPayerMe: true, title: true },
            })
          : null;
        if (!offer) {
          throw new BadRequestException(
            'اطلاعات پیشنهاد معاوضه برای تسویه مالی یافت نشد',
          );
        }

        const extra = Number(offer.extraPayment || 0);
        const hasExtraPayment = extra > 0;
        const extraReceiverUserId = hasExtraPayment
          ? offer.isPayerMe
            ? existing.sellerId
            : existing.buyerId
          : null;
        const sellerIsExtraReceiver = extraReceiverUserId === existing.sellerId;
        const buyerIsExtraReceiver = extraReceiverUserId === existing.buyerId;
        const offerTitle = offer.title;

        const sellerWallet = await tx.wallet.upsert({
          where: { userId: existing.sellerId },
          create: {
            userId: existing.sellerId,
            balanceAvailable: 0,
            balanceBlocked: 0,
          },
          update: {},
          select: { id: true, balanceAvailable: true, balanceBlocked: true },
        });
        const buyerWallet = await tx.wallet.upsert({
          where: { userId: existing.buyerId },
          create: {
            userId: existing.buyerId,
            balanceAvailable: 0,
            balanceBlocked: 0,
          },
          update: {},
          select: { id: true, balanceAvailable: true, balanceBlocked: true },
        });

        if (listingSettlementAmount > 0 && !sellerIsExtraReceiver) {
          const sellerAvailableNow = Number(sellerWallet.balanceAvailable || 0);
          if (listingSettlementAmount > sellerAvailableNow) {
            return {
              kind: 'awaiting_wallet_topup' as const,
              debtorUserId: existing.sellerId,
              shortfall: listingSettlementAmount - sellerAvailableNow,
            };
          }
        }
        if (offerSettlementAmount > 0 && !buyerIsExtraReceiver) {
          const buyerAvailableNow = Number(buyerWallet.balanceAvailable || 0);
          if (offerSettlementAmount > buyerAvailableNow) {
            return {
              kind: 'awaiting_wallet_topup' as const,
              debtorUserId: existing.buyerId,
              shortfall: offerSettlementAmount - buyerAvailableNow,
            };
          }
        }

        // ۱) اصلاح مالی کالای فروشنده: کاهش از فروشنده -> افزایش به خریدار
        if (listingSettlementAmount > 0) {
          if (!sellerIsExtraReceiver) {
            // حالت ۱: کسر از پرداخت‌کننده سرک -> از available و افزودن به blocked طرف مقابل
            await tx.wallet.update({
              where: { userId: existing.sellerId },
              data: {
                balanceAvailable: { decrement: listingSettlementAmount },
              },
            });
            await tx.walletTransaction.create({
              data: {
                walletId: sellerWallet.id,
                amount: listingSettlementAmount,
                type: WalletTransactionType.PENALTY,
                status: WalletTransactionStatus.SUCCESS,
                referenceId: existing.id,
                meta: buildExchangeSettlementWalletMeta({
                  order: existing,
                  itemSide: 'listing',
                  offerTitle,
                  amount: listingSettlementAmount,
                  phase: 'seller_settlement_debit_available',
                }) as Prisma.InputJsonValue,
              },
            });
            await tx.wallet.update({
              where: { userId: existing.buyerId },
              data: { balanceBlocked: { increment: listingSettlementAmount } },
            });
            await tx.walletTransaction.create({
              data: {
                walletId: buyerWallet.id,
                amount: listingSettlementAmount,
                type: WalletTransactionType.DEPOSIT,
                status: WalletTransactionStatus.PENDING,
                referenceId: existing.id,
                meta: buildExchangeSettlementWalletMeta({
                  order: existing,
                  itemSide: 'listing',
                  offerTitle,
                  amount: listingSettlementAmount,
                  phase: 'buyer_settlement_blocked',
                }) as Prisma.InputJsonValue,
              },
            });
          } else {
            // حالت ۲: کسر از دریافت‌کننده سرک -> از blocked همان سفارش
            const sellerScopedBlocked =
              await this.walletService.getOrderScopedBlockedAmount(tx, {
                userId: existing.sellerId,
                orderId: existing.id,
                listingId: existing.listing.id,
              });
            if (listingSettlementAmount > sellerScopedBlocked) {
              throw new BadRequestException(
                'برای اعمال اصلاح مالی کالای فروشنده، مبلغ بلوکه‌شده این معامله کافی نیست',
              );
            }
            await this.walletService.debitOrderScopedBlocked(tx, {
              userId: existing.sellerId,
              orderId: existing.id,
              listingId: existing.listing.id,
              requestedAmount: listingSettlementAmount,
              referenceId: existing.id,
              penaltyMeta: buildExchangeSettlementWalletMeta({
                order: existing,
                itemSide: 'listing',
                offerTitle,
                amount: listingSettlementAmount,
                phase: 'seller_settlement_debit_blocked',
              }) as Prisma.InputJsonValue,
            });
            await tx.wallet.update({
              where: { userId: existing.buyerId },
              data: {
                balanceAvailable: { increment: listingSettlementAmount },
              },
            });
            await tx.walletTransaction.create({
              data: {
                walletId: buyerWallet.id,
                amount: listingSettlementAmount,
                type: WalletTransactionType.REFUND,
                status: WalletTransactionStatus.SUCCESS,
                referenceId: existing.id,
                meta: buildExchangeSettlementWalletMeta({
                  order: existing,
                  itemSide: 'listing',
                  offerTitle,
                  amount: listingSettlementAmount,
                  phase: 'buyer_settlement_credit_available',
                }) as Prisma.InputJsonValue,
              },
            });
          }
        }

        // ۲) اصلاح مالی کالای خریدار: کاهش از خریدار -> افزایش به فروشنده
        if (offerSettlementAmount > 0) {
          if (!buyerIsExtraReceiver) {
            // حالت ۱: کسر از پرداخت‌کننده سرک -> از available و افزودن به blocked طرف مقابل
            await tx.wallet.update({
              where: { userId: existing.buyerId },
              data: { balanceAvailable: { decrement: offerSettlementAmount } },
            });
            await tx.walletTransaction.create({
              data: {
                walletId: buyerWallet.id,
                amount: offerSettlementAmount,
                type: WalletTransactionType.PENALTY,
                status: WalletTransactionStatus.SUCCESS,
                referenceId: existing.id,
                meta: buildExchangeSettlementWalletMeta({
                  order: existing,
                  itemSide: 'offer',
                  offerTitle,
                  amount: offerSettlementAmount,
                  phase: 'buyer_settlement_debit_available',
                }) as Prisma.InputJsonValue,
              },
            });
            await tx.wallet.update({
              where: { userId: existing.sellerId },
              data: { balanceBlocked: { increment: offerSettlementAmount } },
            });
            await tx.walletTransaction.create({
              data: {
                walletId: sellerWallet.id,
                amount: offerSettlementAmount,
                type: WalletTransactionType.DEPOSIT,
                status: WalletTransactionStatus.PENDING,
                referenceId: existing.id,
                meta: buildExchangeSettlementWalletMeta({
                  order: existing,
                  itemSide: 'offer',
                  offerTitle,
                  amount: offerSettlementAmount,
                  phase: 'seller_settlement_blocked',
                }) as Prisma.InputJsonValue,
              },
            });
          } else {
            // حالت ۲: کسر از دریافت‌کننده سرک -> از blocked و بازگشت مستقیم به available پرداخت‌کننده سرک
            const buyerBlockedForOrder =
              await this.walletService.getOrderScopedBlockedAmount(tx, {
                userId: existing.buyerId,
                orderId: existing.id,
                listingId: existing.listing.id,
              });
            if (offerSettlementAmount > buyerBlockedForOrder) {
              throw new BadRequestException(
                'برای اعمال اصلاح مالی کالای خریدار، مبلغ بلوکه‌شده این معامله کافی نیست',
              );
            }
            await this.walletService.debitOrderScopedBlocked(tx, {
              userId: existing.buyerId,
              orderId: existing.id,
              listingId: existing.listing.id,
              requestedAmount: offerSettlementAmount,
              referenceId: existing.id,
              penaltyMeta: buildExchangeSettlementWalletMeta({
                order: existing,
                itemSide: 'offer',
                offerTitle,
                amount: offerSettlementAmount,
                phase: 'buyer_settlement_debit_blocked',
              }) as Prisma.InputJsonValue,
            });
            await tx.wallet.update({
              where: { userId: existing.sellerId },
              data: { balanceAvailable: { increment: offerSettlementAmount } },
            });
            await tx.walletTransaction.create({
              data: {
                walletId: sellerWallet.id,
                amount: offerSettlementAmount,
                type: WalletTransactionType.REFUND,
                status: WalletTransactionStatus.SUCCESS,
                referenceId: existing.id,
                meta: buildExchangeSettlementWalletMeta({
                  order: existing,
                  itemSide: 'offer',
                  offerTitle,
                  amount: offerSettlementAmount,
                  phase: 'seller_settlement_credit_available',
                }) as Prisma.InputJsonValue,
              },
            });
          }
        }

        return {
          kind: 'completed' as const,
          order: await tx.order.update({
            where: { id },
            data: {
              status: OrderStatus.VERIFIED_AT_HUB,
              cancelReason: summaryText,
              sellerRevenue: sellerAfter,
              exchangeHubInspection: inspectionPayload as Prisma.InputJsonValue,
            },
          }),
        };
      });

      if (updated.kind === 'awaiting_wallet_topup') {
        const pendingPayload = mergeInspectionPayload({
          awaitingFinanceSettlement: true,
          pendingFinancialSettlement: {
            listingItem: dto.listingItem,
            offerItem: dto.offerItem,
            listingSettlementAmount,
            offerSettlementAmount,
            listingSettlementDirection,
            offerSettlementDirection,
            listingNote: dto.listingNote?.trim() || null,
            offerNote: dto.offerNote?.trim() || null,
            debtorUserId: updated.debtorUserId,
            shortfall: updated.shortfall,
            requestedAt: new Date().toISOString(),
          },
          financialSettlementSummary: null,
        });
        const awaitingOrder = await this.prisma.order.update({
          where: { id },
          data: {
            status: OrderStatus.CHECKING_AT_HUB,
            cancelReason: [
              summaryText,
              'در انتظار شارژ کیف پول برای تکمیل توافق مالی.',
              `کسری موجودی: ${updated.shortfall.toLocaleString('fa-IR')} تومان`,
            ].join('\n'),
            exchangeHubInspection: pendingPayload as Prisma.InputJsonValue,
          },
        });
        const debtorLabel =
          updated.debtorUserId === existing.sellerId ? 'فروشنده' : 'خریدار';
        await this.prisma.notification.createMany({
          data: [
            {
              userId: updated.debtorUserId,
              type: NotificationType.ORDER_STATUS_CHANGED,
              title: 'شارژ کیف پول برای ادامه معاوضه',
              message: `برای اعمال توافق مالی کارشناسی، ${updated.shortfall.toLocaleString('fa-IR')} تومان به کیف پول شما نیاز است. پس از شارژ، پشتیبانی دوباره تسویه را ثبت می‌کند.`,
              meta: {
                orderId: id,
                shortfall: updated.shortfall,
                awaitingFinanceSettlement: true,
              } as Prisma.InputJsonValue,
            },
            {
              userId:
                updated.debtorUserId === existing.buyerId
                  ? existing.sellerId
                  : existing.buyerId,
              type: NotificationType.ORDER_STATUS_CHANGED,
              title: 'در انتظار تسویه مالی معاوضه',
              message: `معامله در انتظار شارژ کیف پول ${debtorLabel} برای تکمیل توافق مالی کارشناسی است.`,
              meta: { orderId: id } as Prisma.InputJsonValue,
            },
          ],
        });
        return awaitingOrder;
      }

      const settlementTicketBody = buildExchangeFinancialSettlementTicketBody(
        settlementMessagingInput,
      );
      const orderShortId = id.slice(-6).toUpperCase();
      const [buyerSettlementTicket, sellerSettlementTicket] = await Promise.all([
        this.prisma.ticket.create({
          data: {
            userId: existing.buyerId,
            subject: buildOrderTicketSubject(
              EXCHANGE_FINANCIAL_SETTLEMENT_TICKET_SUBJECT,
              id,
            ),
            status: 'OPEN',
            messages: {
              create: {
                senderRole: UserRole.ADMIN,
                message: settlementTicketBody,
              },
            },
          },
          select: { id: true },
        }),
        this.prisma.ticket.create({
          data: {
            userId: existing.sellerId,
            subject: buildOrderTicketSubject(
              EXCHANGE_FINANCIAL_SETTLEMENT_TICKET_SUBJECT,
              id,
            ),
            status: 'OPEN',
            messages: {
              create: {
                senderRole: UserRole.ADMIN,
                message: settlementTicketBody,
              },
            },
          },
          select: { id: true },
        }),
      ]);

      await this.prisma.notification.createMany({
        data: [
          {
            userId: existing.buyerId,
            type: NotificationType.TICKET_REPLY,
            title: 'تیکت کارشناسی معاوضه',
            message:
              buildExchangeFinancialSettlementTicketNotifyMessage(orderShortId),
            meta: {
              orderId: id,
              ticketId: buyerSettlementTicket.id,
            } as Prisma.InputJsonValue,
          },
          {
            userId: existing.sellerId,
            type: NotificationType.TICKET_REPLY,
            title: 'تیکت کارشناسی معاوضه',
            message:
              buildExchangeFinancialSettlementTicketNotifyMessage(orderShortId),
            meta: {
              orderId: id,
              ticketId: sellerSettlementTicket.id,
            } as Prisma.InputJsonValue,
          },
        ],
      });

      await this.notify.notifyParties(
        existing.buyerId,
        existing.sellerId,
        id,
        OrderStatus.VERIFIED_AT_HUB,
        undefined,
        {
          statusLabel: ORDER_STATUS_FINANCIAL_SETTLEMENT_LABEL_FA,
          title: EXCHANGE_FINANCIAL_SETTLEMENT_NOTIFY_TITLE,
          message: buildExchangeFinancialSettlementNotifyMessage(orderShortId),
          metaExtras: {
            resolution: 'FINANCIAL_SETTLEMENT_THEN_SHIP',
            settlementKind: 'exchange-financial-settlement',
            phase: 'exchange_financial_settlement',
          },
        },
      );
      return updated.order;
    }

    // RETURN_BOTH_TO_SENDERS
    const summaryLines = [
      'نتیجه کارشناسی معاوضه — مرجوع هر دو کالا به فرستندگان:',
      `۱) کالای آگهی: ${itemLabel(dto.listingItem)}`,
      dto.listingNote?.trim() ? `   توضیح: ${dto.listingNote.trim()}` : null,
      `۲) کالای پیشنهاد: ${itemLabel(dto.offerItem)}`,
      dto.offerNote?.trim() ? `   توضیح: ${dto.offerNote.trim()}` : null,
    ].filter(Boolean) as string[];

    const summaryText = summaryLines.join('\n');
    const compensationPercent =
      await this.readExchangeNoShipmentCompensationPercent();
    const exchangeInspectionTemplates =
      await this.readExchangeInspectionTicketTemplates();

    return this.prisma.$transaction(async (tx) => {
      const refundSummary =
        await this.walletService.applyExchangeHubInspectionOutcomeRefunds(tx, {
          orderId: id,
          listingId: existing.listing.id,
          buyerId: existing.buyerId,
          sellerId: existing.sellerId,
          verificationFee: Number(existing.verificationFee || 0),
          inspectionPenaltyPercent: compensationPercent,
          listingFailed,
          offerFailed,
        });

      const inspectionPayload = mergeInspectionPayload({
        awaitingFinanceSettlement: false,
        financialSettlementSummary: null,
        lastFinancialSettlement: null,
        awaitingReturnConfirmations: true,
        buyerReturnReceived: false,
        sellerReturnReceived: false,
        refundsReleasedAt: new Date().toISOString(),
        buyerRefundAmount: refundSummary.buyerRefundAmount,
        sellerRefundAmount: refundSummary.sellerRefundAmount,
        ...(offerFailed && !listingFailed
          ? {
              awaitingSellerRelistChoice: true,
              sellerRelistChoice: null,
            }
          : {}),
      });

      const updatedOrder = await tx.order.update({
        where: { id },
        data: {
          status: OrderStatus.REJECTED_AT_HUB,
          cancelReason:
            'رد کارشناسی معاوضه؛ کالاها از هاب به فرستندگان مرجوع می‌شوند.',
          exchangeHubInspection: inspectionPayload as Prisma.InputJsonValue,
        },
      });

      const failurePenalizeUserIds: string[] = [];
      if (listingFailed) failurePenalizeUserIds.push(existing.sellerId);
      if (offerFailed) failurePenalizeUserIds.push(existing.buyerId);

      await this.orderReputation.recordTerminalOutcome(
        tx,
        {
          id: existing.id,
          buyerId: existing.buyerId,
          sellerId: existing.sellerId,
          tradeReputationAt: existing.tradeReputationAt,
        },
        existing.status,
        'FAILURE',
        { failurePenalizeUserIds },
      );

      if (listingFailed) {
        const bothFailed = listingFailed && offerFailed;
        const rejectionReason = bothFailed
          ? 'رد کارشناسی هر دو کالا در معاوضه؛ آگهی از انتشار خارج شد.'
          : `رد کارشناسی کالای آگهی (معاوضه): ${dto.listingNote?.trim() || 'مطابق گزارش کارشناسی'}`;
        await this.listingCommand.rejectAfterTradeFailure(tx, {
          listingId: existing.listing.id,
          sellerId: existing.sellerId,
          listingTitle: existing.listing.title,
          rejectionReason,
          source: 'hub-inspection',
          orderId: id,
        });
      } else if (offerFailed && !listingFailed) {
        // کالای آگهی تایید شده؛ آگهی نباید «فروخته‌شده» بماند تا فروشنده بتواند دوباره منتشر کند.
        await tx.listing.update({
          where: { id: existing.listing.id },
          data: { status: ListingStatus.APPROVED },
        });
      }

      const sellerTicketMessage =
        this.buildExchangeReturnInspectionTicketMessage({
          role: 'seller',
          orderId: id,
          listingTitle: existing.listing.title,
          listingFailed,
          offerFailed,
          ownNote: dto.listingNote?.trim() || null,
          refundAmount: refundSummary.sellerRefundAmount,
          templates: exchangeInspectionTemplates,
        });

      const sellerTicket = await tx.ticket.create({
        data: {
          userId: existing.sellerId,
          subject: buildOrderTicketSubject('کارشناسی معاوضه — مرجوع دوطرفه', id),
          status: 'OPEN',
          messages: {
            create: {
              senderRole: UserRole.ADMIN,
              message: sellerTicketMessage,
            },
          },
        },
        select: { id: true },
      });

      await tx.notification.create({
        data: {
          userId: existing.sellerId,
          type: NotificationType.TICKET_REPLY,
          title: 'تیکت نتیجه کارشناسی معاوضه',
          message: `برای سفارش #${id.slice(-6)} تیکت پشتیبانی ایجاد شد.`,
          meta: {
            orderId: id,
            ticketId: sellerTicket.id,
          } as Prisma.InputJsonValue,
        },
      });

      const buyerTicketMessage =
        this.buildExchangeReturnInspectionTicketMessage({
          role: 'buyer',
          orderId: id,
          listingTitle: existing.listing.title,
          listingFailed,
          offerFailed,
          ownNote: dto.offerNote?.trim() || null,
          refundAmount: refundSummary.buyerRefundAmount,
          templates: exchangeInspectionTemplates,
        });

      const buyerTicket = await tx.ticket.create({
        data: {
          userId: existing.buyerId,
          subject: buildOrderTicketSubject('کارشناسی معاوضه — مرجوع دوطرفه', id),
          status: 'OPEN',
          messages: {
            create: { senderRole: UserRole.ADMIN, message: buyerTicketMessage },
          },
        },
        select: { id: true },
      });

      await tx.notification.create({
        data: {
          userId: existing.buyerId,
          type: NotificationType.TICKET_REPLY,
          title: 'تیکت نتیجه کارشناسی معاوضه',
          message: `برای سفارش #${id.slice(-6)} تیکت پشتیبانی ایجاد شد.`,
          meta: {
            orderId: id,
            ticketId: buyerTicket.id,
          } as Prisma.InputJsonValue,
        },
      });

      await this.notify.notifyParties(
        existing.buyerId,
        existing.sellerId,
        id,
        OrderStatus.REJECTED_AT_HUB,
        'کارشناسی معاوضه رد شد؛ کالای شما از هاب مرجوع می‌شود. جزئیات در تیکت پشتیبانی.',
      );

      return updatedOrder;
    });
  }

  private async readExchangeNoShipmentCompensationPercent(): Promise<number> {
    const setting = await this.prisma.systemSetting.findFirst({
      where: { key: 'EXCHANGE_NO_SHIPMENT_COMPENSATION' },
    });
    const parsed = Number(setting?.value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 20;
    }
    return Math.min(100, Math.floor(parsed));
  }

  /**
   * معاوضه: ادمین تأیید می‌کند طرفی کد رهگیری زده ولی مرسوله به هاب نرسیده — لغو معامله و بازپرداخت.
   */
  async rejectExchangeFakeShipment(
    id: string,
    dto: RejectExchangeFakeShipmentDto,
  ) {
    const note = dto.note?.trim();
    if (!note) {
      throw new BadRequestException('ثبت توضیح برای رد دریافت الزامی است');
    }

    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { listing: { select: { id: true, title: true } } },
    });
    if (!order) throw new NotFoundException('سفارش یافت نشد');
    if (order.type !== 'EXCHANGE') {
      throw new BadRequestException('این عملیات فقط برای معاوضه مجاز است');
    }
    if (
      order.status !== OrderStatus.SHIPPED_TO_HUB &&
      order.status !== OrderStatus.RECEIVED_AT_HUB &&
      order.status !== OrderStatus.CHECKING_AT_HUB
    ) {
      throw new BadRequestException(
        'سفارش در وضعیت مناسب برای رد دریافت مرسوله نیست',
      );
    }

    const prevInspection =
      (order.exchangeHubInspection as Record<string, unknown> | null) ?? {};
    if (prevInspection['finalizedAt']) {
      throw new BadRequestException('کارشناسی این معامله قبلاً نهایی شده است');
    }

    const listingShipped = Boolean(order.trackingCode?.trim());
    const offerShipped = Boolean(order.sellerTrackingCode?.trim());
    const offenderSideShipped =
      dto.side === 'LISTING' ? listingShipped : offerShipped;
    if (!offenderSideShipped) {
      throw new BadRequestException(
        'این طرف هنوز کد رهگیری ثبت نکرده؛ از مسیر عدم ارسال معمولی استفاده کنید',
      );
    }

    const otherSideShipped =
      dto.side === 'LISTING' ? offerShipped : listingShipped;
    const offenderId =
      dto.side === 'LISTING' ? order.sellerId : order.buyerId;
    const senderId =
      dto.side === 'LISTING' ? order.buyerId : order.sellerId;
    const compensationPercent =
      await this.readExchangeNoShipmentCompensationPercent();
    const listingTitle = order.listing?.title?.trim() || 'کالا';
    const shortId = id.slice(-6);

    return this.prisma.$transaction(async (tx) => {
      const prevStatus = order.status;

      if (otherSideShipped) {
        const refundSummary =
          await this.walletService.refundExchangeOneSideNoShipmentOnCancel(tx, {
            orderId: id,
            listingId: order.listingId,
            buyerId: order.buyerId,
            sellerId: order.sellerId,
            senderId,
            offenderId,
            verificationFee: Number(order.verificationFee || 0),
            inspectionPenaltyPercent: compensationPercent,
          });

        await tx.order.update({
          where: { id },
          data: {
            status: OrderStatus.REJECTED_AT_HUB,
            cancelReason: `رد دریافت توسط ادمین — ارسال واقعی نشده (${dto.side === 'LISTING' ? 'کالای آگهی' : 'کالای پیشنهادی'}): ${note}`,
            exchangeHubInspection: {
              ...prevInspection,
              resolution: 'RETURN_BOTH_TO_SENDERS',
              singleSideNoShipmentTimeout: true,
              adminFakeShipment: true,
              adminFakeShipmentSide: dto.side,
              adminFakeShipmentNote: note,
              skipInspection: true,
              returnOnlyLeg: dto.side === 'LISTING' ? 'SELLER' : 'BUYER',
              returnSenderUserId: senderId,
              awaitingReturnConfirmations: false,
              refundsReleasedAt: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          },
        });

        await this.orderReputation.recordTerminalOutcome(
          tx,
          {
            id,
            buyerId: order.buyerId,
            sellerId: order.sellerId,
            tradeReputationAt: order.tradeReputationAt,
          },
          prevStatus,
          'FAILURE',
          { failurePenalizeUserIds: [offenderId] },
        );

        if (offenderId === order.sellerId) {
          await this.listingCommand.rejectAfterTradeFailure(tx, {
            listingId: order.listingId,
            sellerId: order.sellerId,
            listingTitle,
            rejectionReason:
              'معامله به‌دلیل عدم ارسال واقعی مرسوله (ثبت کد جعلی) لغو شد.',
            orderId: id,
            source: 'hub-inspection',
          });
        } else {
          await tx.listing.update({
            where: { id: order.listingId },
            data: { status: ListingStatus.APPROVED },
          });
          if (order.exchangeOfferId) {
            await tx.exchangeOffer.updateMany({
              where: {
                listingId: order.listingId,
                status: ExchangeOfferStatus.WAITLISTED,
              },
              data: { status: ExchangeOfferStatus.PENDING },
            });
          }
        }

        const senderTicketBody = formatTicketMessageBody([
          `معامله معاوضه #${shortId} برای «${listingTitle}» توسط تیم طبقه لغو شد.`,
          'دلیل: طرف مقابل کد رهگیری ثبت کرده بود اما مرسوله به هاب نرسید؛ شما به‌موقع ارسال کرده بودید.',
          `مبلغ ${Math.max(0, refundSummary.senderRefund).toLocaleString('fa-IR')} تومان به کیف پول شما برگشت.`,
          refundSummary.compensation > 0
            ? `همچنین ${refundSummary.compensation.toLocaleString('fa-IR')} تومان بابت جبران از سهم کارشناسی طرف مقابل واریز شد.`
            : '',
          'کالای شما در صف مرجوع از هاب قرار می‌گیرد.',
        ].filter((line): line is string => Boolean(line)));

        const offenderTicketBody = formatTicketMessageBody([
          `معامله معاوضه #${shortId} لغو شد.`,
          'دلیل: ادمین تأیید کرد مرسوله شما با وجود کد رهگیری به هاب نرسیده است.',
          `توضیح: ${note}`,
          `${compensationPercent}٪ از هزینه کارشناسی به‌عنوان جریمه کسر شد.`,
          '۱۵ واحد از امتیاز اعتماد شما کسر شد.',
        ]);

        await tx.ticket.create({
          data: {
            userId: senderId,
            subject: buildOrderTicketSubject('لغو معاوضه — بازگشت وجه', id),
            status: 'OPEN',
            messages: {
              create: {
                senderRole: UserRole.ADMIN,
                message: senderTicketBody,
              },
            },
          },
        });
        await tx.ticket.create({
          data: {
            userId: offenderId,
            subject: buildOrderTicketSubject('عدم ارسال واقعی — لغو معاوضه', id),
            status: 'OPEN',
            messages: {
              create: {
                senderRole: UserRole.ADMIN,
                message: offenderTicketBody,
              },
            },
          },
        });

        return { status: OrderStatus.REJECTED_AT_HUB, offenderId, senderId };
      }

      const bothRefund =
        await this.walletService.refundExchangeBothNoShipmentOnCancel(tx, {
          orderId: id,
          listingId: order.listingId,
          buyerId: order.buyerId,
          sellerId: order.sellerId,
          verificationFee: Number(order.verificationFee || 0),
          inspectionPenaltyPercent: 0,
        });

      const targetStatus =
        order.status === OrderStatus.SHIPPED_TO_HUB
          ? OrderStatus.CANCELLED
          : OrderStatus.REJECTED_AT_HUB;

      await tx.order.update({
        where: { id },
        data: {
          status: targetStatus,
          cancelReason: `لغو توسط ادمین — ارسال واقعی طرف ${dto.side === 'LISTING' ? 'آگهی' : 'پیشنهاد'} انجام نشده: ${note}`,
          exchangeHubInspection: {
            ...prevInspection,
            adminFakeShipment: true,
            adminFakeShipmentSide: dto.side,
            adminFakeShipmentNote: note,
            skipInspection: true,
            singleSideNoShipmentTimeout: targetStatus === OrderStatus.REJECTED_AT_HUB,
          } as Prisma.InputJsonValue,
        },
      });

      await this.orderReputation.recordTerminalOutcome(
        tx,
        {
          id,
          buyerId: order.buyerId,
          sellerId: order.sellerId,
          tradeReputationAt: order.tradeReputationAt,
        },
        prevStatus,
        'FAILURE',
        { failurePenalizeUserIds: [offenderId] },
      );

      await this.listingCommand.rejectAfterTradeFailure(tx, {
        listingId: order.listingId,
        sellerId: order.sellerId,
        listingTitle,
        rejectionReason:
          'معامله معاوضه به‌دلیل عدم ارسال واقعی لغو شد.',
        orderId: id,
        source: 'hub-inspection',
      });

      const cancelBody = formatTicketMessageBody([
        `معامله معاوضه #${shortId} برای «${listingTitle}» لغو شد.`,
        `دلیل: ${note}`,
        'هیچ‌یک از طرفین ارسال معتبر به هاب نداشتند یا ارسال ثبت‌شده تأیید نشد.',
      ]);
      await tx.ticket.create({
        data: {
          userId: order.buyerId,
          subject: buildOrderTicketSubject('لغو معاوضه', id),
          status: 'OPEN',
          messages: {
            create: { senderRole: UserRole.ADMIN, message: cancelBody },
          },
        },
      });
      await tx.ticket.create({
        data: {
          userId: order.sellerId,
          subject: buildOrderTicketSubject('لغو معاوضه', id),
          status: 'OPEN',
          messages: {
            create: { senderRole: UserRole.ADMIN, message: cancelBody },
          },
        },
      });

      return {
        status: targetStatus,
        bothRefund,
        offenderId,
      };
    });
  }

  private getExchangePaymentTrustPenalty(
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<number> {
    return readPositiveIntSetting(tx, 'EXCHANGE_PAYMENT_TRUST_PENALTY', 15);
  }
}
