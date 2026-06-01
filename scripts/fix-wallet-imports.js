/** Fix import paths and visibility after wallet extraction. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const walletDir = path.join(root, 'src/modules/wallet/services');

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(p));
    else if (entry.name.endsWith('.ts')) files.push(p);
  }
  return files;
}

for (const file of walk(walletDir)) {
  let content = fs.readFileSync(file, 'utf8');
  content = content
    .replace(
      /from '\.\.\/\.\.\/\.\.\/infrastructure\//g,
      "from '../../../../infrastructure/",
    )
    .replace(
      /from '\.\.\/\.\.\/notification\//g,
      "from '../../../notification/",
    )
    .replace(
      /from '\.\.\/\.\.\/\.\.\/shared\//g,
      "from '../../../../shared/",
    )
    .replace(/\nimport { NotificationService } from '\.\.\/\.\.\/\.\.\/notification\/notification\.service';\n\n/g, '\n')
    .replace(/\nimport { NotificationService } from '\.\.\/\.\.\/\.\.\/notification\/notification\.service';\n/g, '\n');

  if (file.includes('wallet-support.service.ts')) {
    content = content
      .replace(/private async notifyWalletRefund/g, 'async notifyWalletRefund')
      .replace(/private settlementBelongsToExchangeOrder/g, 'settlementBelongsToExchangeOrder')
      .replace(/private async listingTitleForWalletTx/g, 'async listingTitleForWalletTx')
      .replace(/private async ensureUserWallet/g, 'async ensureUserWallet');
  }

  if (file.includes('wallet-escrow.service.ts')) {
    content = content.replace(
      /private escrowDepositBelongsToOrder/g,
      'escrowDepositBelongsToOrder',
    );
  }

  if (file.includes('wallet-query.service.ts')) {
    content = content.replace(
      "import { ALLOWED_WALLET_META_KEYS, UserWalletTxFilter, WalletTxnRow } from '../../wallet.constants';",
      "import { ALLOWED_WALLET_META_KEYS, GATEWAY_TOPUP_KIND, UserWalletTxFilter, WalletTxnRow } from '../../wallet.constants';",
    );
    content = content
      .replace(/\nimport { NotificationService }[^\n]+\n/g, '\n')
      .replace(/NotificationType,\n/g, '');
    content = content.replace(
      /WalletTransactionStatus,\n  Prisma,\n/g,
      'WalletTransactionStatus,\n  Prisma,\n',
    );
  }

  fs.writeFileSync(file, content, 'utf8');
  console.log('fixed', path.relative(root, file));
}

console.log('done');
