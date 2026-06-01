const fs = require('fs');
const path = require('path');

const files = [
  'src/modules/orders/services/command/orders-checkout.service.ts',
  'src/modules/orders/services/command/orders-shipping.service.ts',
  'src/modules/orders/services/command/orders-completion.service.ts',
  'src/modules/orders/services/scheduler/orders-scheduler.service.ts',
];

for (const rel of files) {
  const p = path.join(__dirname, '..', rel);
  let c = fs.readFileSync(p, 'utf8');
  if (!c.includes('BadRequestException')) {
    c = c.replace(
      "import { Inject, Injectable, forwardRef } from '@nestjs/common';",
      "import {\n  BadRequestException,\n  ForbiddenException,\n  Injectable,\n  NotFoundException,\n} from '@nestjs/common';",
    );
    c = c.replace(
      "import { Injectable } from '@nestjs/common';",
      "import {\n  BadRequestException,\n  ForbiddenException,\n  Injectable,\n  NotFoundException,\n} from '@nestjs/common';",
    );
  }
  if (c.includes("import { Inject, Injectable, forwardRef }")) {
    // keep forwardRef import for shipping
  }
  c = c.replace(/this\.parsePositiveIntSetting\(/g, 'this.settings.parsePositiveIntSetting(');
  fs.writeFileSync(p, c, 'utf8');
}

const checkoutPath = path.join(__dirname, '..', 'src/modules/orders/services/command/orders-checkout.service.ts');
let checkout = fs.readFileSync(checkoutPath, 'utf8');
if (!checkout.includes('DEFAULT_SELLER_SHIP_DEADLINE_MINUTES')) {
  checkout = checkout.replace(
    "import {\n  AWAITING_SELLER_SHIPMENT_STATUSES,",
    "import {\n  DEFAULT_SELLER_SHIP_DEADLINE_MINUTES,\n  AWAITING_SELLER_SHIPMENT_STATUSES,",
  );
}
fs.writeFileSync(checkoutPath, checkout, 'utf8');
console.log('patched command/scheduler files');
