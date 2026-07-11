/**
 * تعمیر سفارش‌های DIRECT که پرداخت شده‌اند ولی امانت خرید / لاگ مالی ثبت نشده.
 *
 * Usage (from tabaghe-api):
 *   npx ts-node -r tsconfig-paths/register scripts/repair-missing-purchase-escrow.ts
 *   npx ts-node -r tsconfig-paths/register scripts/repair-missing-purchase-escrow.ts --force
 *   npx ts-node -r tsconfig-paths/register scripts/repair-missing-purchase-escrow.ts --order=<orderId>
 *   npx ts-node -r tsconfig-paths/register scripts/repair-missing-purchase-escrow.ts --dry-run
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { WalletService } from '../src/modules/wallet/wallet.service';

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const dryRun = args.includes('--dry-run');
  const orderArg = args.find((a) => a.startsWith('--order='));
  const orderId = orderArg?.slice('--order='.length)?.trim();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const wallet = app.get(WalletService);

    if (orderId) {
      if (dryRun) {
        const presence = await wallet.getPurchaseEscrowPresence(orderId);
        console.log(JSON.stringify({ orderId, presence, dryRun: true }, null, 2));
        return;
      }
      const result = await wallet.repairMissingPurchaseEscrow(orderId, { force });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const missing = await wallet.findOrdersMissingPurchaseEscrow(200);
    console.log(`Found ${missing.length} order(s) with missing purchase escrow`);
    for (const row of missing) {
      console.log(
        `- ${row.id} status=${row.status} sellerBlocked=${row.sellerBlocked} buyerPaid=${row.buyerPaid} amount=${row.totalAmount}`,
      );
    }
    if (dryRun || missing.length === 0) return;

    let repairedCount = 0;
    for (const row of missing) {
      const result = await wallet.repairMissingPurchaseEscrow(row.id, { force });
      console.log(JSON.stringify({ orderId: row.id, ...result }, null, 2));
      if (result.repaired) repairedCount += 1;
    }
    console.log(`Done. repaired=${repairedCount}/${missing.length}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
