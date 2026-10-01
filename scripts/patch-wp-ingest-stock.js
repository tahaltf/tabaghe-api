const fs = require('fs');
const path =
  'c:/projects/Tabagheh/tabaghe-api/src/modules/wordpress-integration/services/product-ingest.service.ts';
let s = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

// Collapse blank-line-separated style to normal for reliable edits
s = s.replace(/\n{3,}/g, '\n\n');

if (!s.includes('applyMinStockThreshold')) {
  s = s.replace(
    "import type { WordPressSyncOptions } from '../../listing/services/listing-command.service';",
    `import type { WordPressSyncOptions } from '../../listing/services/listing-command.service';
import {
  applyMinStockThreshold,
  normalizeMinStockForAvailable,
} from '../../../common/utils/min-stock-threshold.util';`,
  );
}

const startMarker = '    const isUpdate = !!existing;';
const endMarker = '    let listing;';
const start = s.indexOf(startMarker);
const end = s.indexOf(endMarker, start);
if (start < 0 || end < 0) {
  console.error('markers not found', { start, end });
  process.exit(1);
}

const replacement = `    const isUpdate = !!existing;
    const minStock = await this.connectionService.getMinStockForAvailable(userId);
    const availability = this.resolveAvailability(dto, minStock);

    // پیش‌نویس / حذف‌شده از وردپرس → آرشیو (اگر قبلاً وارد شده)
    if (!availability.isPublished) {
      if (!isUpdate) {
        throw new BadRequestException(
          'فقط محصولات منتشرشده قابل ارسال هستند',
        );
      }
      return this.ingestUnavailableUpdate(userId, existing.id, dto);
    }

    const defaults = await this.resolveDefaults(userId);
    const categoryId = await this.resolveCategoryId(dto, defaults);
    const syncInput = await this.buildSyncInput(
      userId,
      dto,
      defaults,
      categoryId,
      availability.siteStock,
    );

`;

s = s.slice(0, start) + replacement + s.slice(end);

// Replace isProductAvailable + resolveStockQuantity with new helpers
const availStart = s.indexOf('  private isProductAvailable(dto: WordPressProductDto): boolean {');
const availEnd = s.indexOf('  /**\n   * WooCommerce may report');
if (availStart < 0 || availEnd < 0) {
  console.error('availability methods not found');
  process.exit(1);
}

const newHelpers = `  /**
   * isPublished=false → آرشیو/رد ایجاد
   * siteStock=0 با isPublished=true → روی سایت ناموجود (بدون آرشیو)
   */
  private resolveAvailability(
    dto: WordPressProductDto,
    minStockForAvailable: number,
  ): { isPublished: boolean; siteStock: number } {
    if (dto.status && dto.status !== 'publish') {
      return { isPublished: false, siteStock: 0 };
    }

    const min = normalizeMinStockForAvailable(minStockForAvailable);
    const raw = dto.stockQuantity;
    const hasNumericStock =
      raw != null && Number.isFinite(Number(raw)) && Number(raw) >= 0;

    if (hasNumericStock) {
      return {
        isPublished: true,
        siteStock: applyMinStockThreshold(Number(raw), min),
      };
    }

    // موجودی مدیریت نمی‌شود — فلگ‌های موجودی ووکامرس
    if (dto.inStock === false) {
      return { isPublished: true, siteStock: 0 };
    }
    const stockStatus = dto.stockStatus?.toLowerCase();
    if (stockStatus === 'outofstock' || stockStatus === 'out_of_stock') {
      return { isPublished: true, siteStock: 0 };
    }
    return { isPublished: true, siteStock: Math.max(1, min) };
  }

`;

s = s.slice(0, availStart) + newHelpers + s.slice(availEnd);

// Remove old resolveStockQuantity method if still present
s = s.replace(
  /\n  private resolveStockQuantity\(dto: WordPressProductDto\): number \{[\s\S]*?\n  \}\n\n/,
  '\n',
);

// Update buildSyncInput signature to accept siteStock
s = s.replace(
  /private async buildSyncInput\(\s*userId: string,\s*dto: WordPressProductDto,\s*defaults: ListingDefaults,\s*categoryId: string,\s*\)/,
  `private async buildSyncInput(
    userId: string,
    dto: WordPressProductDto,
    defaults: ListingDefaults,
    categoryId: string,
    siteStock: number,
  )`,
);

// Replace stockQuantity: this.resolveStockQuantity(dto)
s = s.replace(
  /stockQuantity:\s*this\.resolveStockQuantity\(dto\)/,
  'stockQuantity: siteStock',
);

// Change ingestUnavailableUpdate to only archive for unpublished; for stock use sync with 0
// Actually ingestUnavailableUpdate is only called for !isPublished now, so archive is correct.
// But buildSyncInput inside ingestUnavailableUpdate needs siteStock arg
s = s.replace(
  /const syncInput = await this\.buildSyncInput\(userId, dto, defaults, categoryId\);\s*\n\s*const \{ listing, archived \} =/,
  `const syncInput = await this.buildSyncInput(userId, dto, defaults, categoryId, 0);

    const { listing, archived } =`,
);

fs.writeFileSync(path, s);
console.log('OK');
console.log('has resolveAvailability', s.includes('resolveAvailability'));
console.log('has resolveStockQuantity', s.includes('resolveStockQuantity'));
console.log('siteStock param', s.includes('siteStock: number'));
