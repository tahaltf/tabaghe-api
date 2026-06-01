/** Fix import paths in extracted orders services. */
const fs = require('fs');
const path = require('path');

const files = [
  'src/modules/orders/services/command/orders-checkout.service.ts',
  'src/modules/orders/services/command/orders-shipping.service.ts',
  'src/modules/orders/services/command/orders-completion.service.ts',
  'src/modules/orders/services/scheduler/orders-scheduler.service.ts',
];

const replacements = [
  ["from '../../../infrastructure/", "from '../../../../infrastructure/"],
  ["from '../../../common/", "from '../../../../common/"],
  ["from '../../../shared/", "from '../../../../shared/"],
  ["from '../../wallet/", "from '../../../wallet/"],
  ["from '../../fees/", "from '../../../fees/"],
  ["from '../../payments/", "from '../../../payments/"],
  ["from '../../notification/", "from '../../../notification/"],
  ["from '../../exchange/", "from '../../../exchange/"],
  ["from '../../quota/", "from '../../../quota/"],
  ["from '../../listing/", "from '../../../listing/"],
];

for (const rel of files) {
  const p = path.join(__dirname, '..', rel);
  let content = fs.readFileSync(p, 'utf8');
  for (const [from, to] of replacements) {
    content = content.split(from).join(to);
  }
  fs.writeFileSync(p, content, 'utf8');
  console.log('fixed', rel);
}

const settingsPath = path.join(__dirname, '..', 'src/modules/orders/orders-settings.service.ts');
let settings = fs.readFileSync(settingsPath, 'utf8');
settings = settings.replace(/this\.settings\./g, 'this.');
fs.writeFileSync(settingsPath, settings, 'utf8');
console.log('fixed settings');
