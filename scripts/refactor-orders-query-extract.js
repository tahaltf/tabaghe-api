/** One-off: extract query methods from orders.service.ts (UTF-8 safe). */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/modules/orders/orders.service.ts');
let content = fs.readFileSync(filePath, 'utf8');
content = content.replace(/\r\n/g, '\n');

if (!content.includes('OrdersResponseEnrichmentService')) {
  content = content.replace(
    "import { formatMinutesDurationFa } from '../../common/duration-format.util';",
    `import { formatMinutesDurationFa } from '../../common/duration-format.util';
import {
  BUYER_CONFIRM_ELIGIBLE_STATUSES,
  OrdersResponseEnrichmentService,
} from './services/query/orders-response-enrichment.service';`,
  );
  content = content.replace(
    '    private readonly listingCommand: ListingCommandService,\n  ) {}',
    `    private readonly listingCommand: ListingCommandService,
    private readonly responseEnrichment: OrdersResponseEnrichmentService,
  ) {}`,
  );
}

const listStart = content.indexOf(
  '  // =================================================================\n  // 1. دریافت سفارش‌ها',
);
const listEnd = content.indexOf(
  '  // =================================================================\n  // 3. متد اصلی ثبت سفارش',
);
if (listStart !== -1 && listEnd !== -1) {
  content = content.slice(0, listStart) + content.slice(listEnd);
}

const detailStart = content.indexOf(
  '  // =================================================================\n  // 6. دریافت جزئیات سفارش',
);
const detailEnd = content.indexOf(
  '  // =================================================================\n  // 7. ثبت شکایت (Dispute)',
);
if (detailStart !== -1 && detailEnd !== -1) {
  content = content.slice(0, detailStart) + content.slice(detailEnd);
}

content = content.replace(
  `import {
  resolveExchangeOfferListDisplay,
  resolveExchangeOrderListDisplay,
} from './exchange-offer-display.util';
`,
  '',
);

content = content.replace(
  `  private static readonly BUYER_CONFIRM_ELIGIBLE_STATUSES: OrderStatus[] = [
    OrderStatus.SHIPPED,
    OrderStatus.SHIPPED_TO_BUYER,
    OrderStatus.DELIVERED,
  ];

`,
  '',
);
content = content.replaceAll(
  'OrdersService.BUYER_CONFIRM_ELIGIBLE_STATUSES',
  'BUYER_CONFIRM_ELIGIBLE_STATUSES',
);

content = content.replace(
  `  computeBuyerConfirmDeadlineNow(): Promise<Date> {
    return this.buildBuyerConfirmDeadlineFrom(new Date());
  }

  private async buildBuyerConfirmDeadlineFrom(from: Date): Promise<Date> {
    const minutes = await this.getBuyerConfirmDeadlineMinutes();
    return new Date(from.getTime() + minutes * 60 * 1000);
  }

  /** پس از ensure در DB، مقدار را روی آبجکت سفارش برای پاسخ API می‌نشاند */
  private async attachBuyerConfirmDeadline<`,
  `  computeBuyerConfirmDeadlineNow(): Promise<Date> {
    return this.responseEnrichment.computeBuyerConfirmDeadlineNow();
  }

  /** @deprecated — retained until cron paths stop using attachBuyerConfirmDeadline */
  private async attachBuyerConfirmDeadline<`,
);

const oldEnsure = `  async ensureBuyerConfirmDeadline(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        buyerConfirmDeadline: true,
        updatedAt: true,
        createdAt: true,
      },
    });
    if (!order) return;
    if (order.buyerConfirmDeadline) return;
    if (!BUYER_CONFIRM_ELIGIBLE_STATUSES.includes(order.status)) {
      return;
    }
    const minutes = await this.getBuyerConfirmDeadlineMinutes();
    const base = order.updatedAt ?? order.createdAt ?? new Date();
    const ageMs = Date.now() - base.getTime();
    // اگر سفارش قدیمی است ولی مهلت در DB ثبت نشده، از «الان» شمارش شود تا UI و کرون منطقی بمانند
    const deadlineBase = ageMs > minutes * 60 * 1000 ? new Date() : base;
    const deadline = await this.buildBuyerConfirmDeadlineFrom(deadlineBase);
    await this.prisma.order.update({
      where: { id: orderId },
      data: { buyerConfirmDeadline: deadline },
    });
  }`;

const newEnsure = `  async ensureBuyerConfirmDeadline(orderId: string): Promise<void> {
    return this.responseEnrichment.ensureBuyerConfirmDeadline(orderId);
  }`;

if (content.includes(oldEnsure)) {
  content = content.replace(oldEnsure, newEnsure);
}

const oldExpired = `  private async isBuyerConfirmDeadlineExpired(order: {
    status: OrderStatus;
    buyerConfirmDeadline: Date | null;
    disputedAt: Date | null;
    updatedAt: Date;
    createdAt: Date;
  }): Promise<boolean> {
    if (order.disputedAt) return false;
    if (!BUYER_CONFIRM_ELIGIBLE_STATUSES.includes(order.status)) {
      return false;
    }
    const deadline = await this.resolveEffectiveBuyerConfirmDeadline(order);
    if (!deadline) return false;
    return deadline.getTime() <= Date.now();
  }`;

const newExpired = `  private async isBuyerConfirmDeadlineExpired(order: {
    status: OrderStatus;
    buyerConfirmDeadline: Date | null;
    disputedAt: Date | null;
    updatedAt: Date;
    createdAt: Date;
  }): Promise<boolean> {
    return this.responseEnrichment.isBuyerConfirmDeadlineExpired(order);
  }`;

if (content.includes(oldExpired)) {
  content = content.replace(oldExpired, newExpired);
}

fs.writeFileSync(filePath, content, 'utf8');
console.log(`Updated ${filePath} (${content.split('\n').length} lines)`);
