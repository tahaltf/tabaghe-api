"""One-off script: extract query methods from orders.service.ts (UTF-8 safe)."""
from __future__ import annotations

path = r"src/modules/orders/orders.service.ts"

with open(path, encoding="utf-8") as f:
    content = f.read()

if "OrdersResponseEnrichmentService" not in content:
    content = content.replace(
        "import { formatMinutesDurationFa } from '../../common/duration-format.util';",
        "import { formatMinutesDurationFa } from '../../common/duration-format.util';\n"
        "import {\n"
        "  BUYER_CONFIRM_ELIGIBLE_STATUSES,\n"
        "  OrdersResponseEnrichmentService,\n"
        "} from './services/query/orders-response-enrichment.service';",
    )
    content = content.replace(
        "    private readonly listingCommand: ListingCommandService,\n  ) {}",
        "    private readonly listingCommand: ListingCommandService,\n"
        "    private readonly responseEnrichment: OrdersResponseEnrichmentService,\n"
        "  ) {}",
    )

list_start = content.find(
    "  // =================================================================\n"
    "  // 1. دریافت سفارش‌ها"
)
list_end = content.find(
    "  // =================================================================\n"
    "  // 3. متد اصلی ثبت سفارش"
)
if list_start != -1 and list_end != -1:
    content = content[:list_start] + content[list_end:]

detail_start = content.find(
    "  // =================================================================\n"
    "  // 6. دریافت جزئیات سفارش"
)
detail_end = content.find(
    "  // =================================================================\n"
    "  // 7. ثبت شکایت"
)
if detail_start != -1 and detail_end != -1:
    content = content[:detail_start] + content[detail_end:]

content = content.replace(
    "import {\n"
    "  resolveExchangeOfferListDisplay,\n"
    "  resolveExchangeOrderListDisplay,\n"
    "} from './exchange-offer-display.util';\n",
    "",
)

# Delegate enrichment helpers used by cron/admin
content = content.replace(
    "  private static readonly BUYER_CONFIRM_ELIGIBLE_STATUSES: OrderStatus[] = [\n"
    "    OrderStatus.SHIPPED,\n"
    "    OrderStatus.SHIPPED_TO_BUYER,\n"
    "    OrderStatus.DELIVERED,\n"
    "  ];\n\n",
    "",
)
content = content.replace(
    "OrdersService.BUYER_CONFIRM_ELIGIBLE_STATUSES",
    "BUYER_CONFIRM_ELIGIBLE_STATUSES",
)

content = content.replace(
    "  computeBuyerConfirmDeadlineNow(): Promise<Date> {\n"
    "    return this.buildBuyerConfirmDeadlineFrom(new Date());\n"
    "  }\n\n"
    "  private async buildBuyerConfirmDeadlineFrom(from: Date): Promise<Date> {\n"
    "    const minutes = await this.getBuyerConfirmDeadlineMinutes();\n"
    "    return new Date(from.getTime() + minutes * 60 * 1000);\n"
    "  }\n\n"
    "  /** پس از ensure در DB، مقدار را روی آبجکت سفارش برای پاسخ API می‌نشاند */\n"
    "  private async attachBuyerConfirmDeadline<",
    "  computeBuyerConfirmDeadlineNow(): Promise<Date> {\n"
    "    return this.responseEnrichment.computeBuyerConfirmDeadlineNow();\n"
    "  }\n\n"
    "  /** @deprecated internal — use OrdersResponseEnrichmentService */\n"
    "  private async attachBuyerConfirmDeadline<",
)

# Replace ensureBuyerConfirmDeadline body with delegate
old_ensure = """  async ensureBuyerConfirmDeadline(orderId: string): Promise<void> {
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
  }"""

new_ensure = """  async ensureBuyerConfirmDeadline(orderId: string): Promise<void> {
    return this.responseEnrichment.ensureBuyerConfirmDeadline(orderId);
  }"""

if old_ensure in content:
    content = content.replace(old_ensure, new_ensure)

old_is_expired = """  private async isBuyerConfirmDeadlineExpired(order: {
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
  }"""

new_is_expired = """  private async isBuyerConfirmDeadlineExpired(order: {
    status: OrderStatus;
    buyerConfirmDeadline: Date | null;
    disputedAt: Date | null;
    updatedAt: Date;
    createdAt: Date;
  }): Promise<boolean> {
    return this.responseEnrichment.isBuyerConfirmDeadlineExpired(order);
  }"""

if old_is_expired in content:
    content = content.replace(old_is_expired, new_is_expired)

with open(path, "w", encoding="utf-8", newline="\n") as f:
    f.write(content)

print(f"Updated {path} ({len(content.splitlines())} lines)")
