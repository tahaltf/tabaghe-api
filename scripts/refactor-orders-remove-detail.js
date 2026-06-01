const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/modules/orders/orders.service.ts');
let content = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');

const detailStart = content.indexOf(
  '  // =================================================================\n  // 6. دریافت جزئیات سفارش',
);
const detailEnd = content.indexOf('  // 7. ثبت شکایت (Dispute)');
if (detailStart === -1 || detailEnd === -1) {
  console.error('markers not found', detailStart, detailEnd);
  process.exit(1);
}
content = content.slice(0, detailStart) + content.slice(detailEnd);
fs.writeFileSync(filePath, content, 'utf8');
console.log('removed getOrderById', content.split('\n').length, 'lines');
