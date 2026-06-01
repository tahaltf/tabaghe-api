/** Extract CommonService into focused services (UTF-8 safe). */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcPath = path.join(root, 'src/common-module/common-module.service.ts');
const lines = fs.readFileSync(srcPath, 'utf8').replace(/\r\n/g, '\n').split('\n');

function slice(start, end) {
  return lines.slice(start - 1, end).join('\n');
}

const locationBody = slice(41, 56);
const categoryBody = slice(58, 512);
const contentBody = slice(513, 803);
const engagementBody = slice(804, 912);
const pwaBody = slice(913, 945);

const sharedImports = `import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
`;

const locationFile = `${sharedImports}

@Injectable()
export class CommonLocationService {
  constructor(private readonly prisma: PrismaService) {}

${locationBody}
}
`;

const categoryFile = `${sharedImports.replace('ConflictException,\n  Injectable', 'Injectable')}
import { ListingStatus, LocationType } from '@prisma/client';
import { findLocationBySlug } from '../location-slug.util';
import { filterCategoriesVisibleOnSite, isCategoryVisibleOnSite } from '../../common/category-visibility.util';

@Injectable()
export class CommonCategoryService {
  constructor(private readonly prisma: PrismaService) {}

${categoryBody.replace(/^  private /gm, '  ')}
}
`;

const contentFile = `${sharedImports.replace('BadRequestException,\n  ConflictException,\n  Injectable', 'Injectable')}
import { parseListingTypesEnabledFromMap } from '../../common/system-settings/listing-type-enabled';
import {
  DEFAULT_ABOUT_US_FA,
  DEFAULT_FAQ_ITEMS,
  DEFAULT_FOOTER_TAGLINE_FA,
  DEFAULT_SYSTEM_INTRO_FA,
  DEFAULT_TERMS_CONDITIONS_FA,
} from '../../common/content';

@Injectable()
export class CommonContentService {
  constructor(private readonly prisma: PrismaService) {}

${contentBody}
}
`;

const engagementFile = `${sharedImports}
import { NotificationType } from '@prisma/client';
import { NotificationService } from '../../modules/notification/notification.service';

@Injectable()
export class CommonEngagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

${engagementBody.replace(/^  private /gm, '  ')}
}
`;

const pwaFile = `${sharedImports.replace('BadRequestException,\n  ConflictException,\n  Injectable', 'Injectable')}
import {
  buildPwaManifestDocument,
  getFrontendAppOrigin,
  getPwaAppIconFilename,
  getPwaFaviconFilename,
  getPwaAppName,
  getPwaAppShortName,
  mimeForBrandFilename,
  resolveBrandLogoAbsolutePath,
  resolveDefaultFaviconPath,
  resolveDefaultPwaAppIconPath,
} from '../../common/pwa-brand-icon.util';

@Injectable()
export class CommonPwaService {
  constructor(private readonly prisma: PrismaService) {}

${pwaBody}
}
`;

const publicMethods = [
  ['getProvinces', 'location'],
  ['getCities', 'location'],
  ['getCategories', 'category'],
  ['getHomeCategories', 'category'],
  ['getCategoryLandingBySlug', 'category'],
  ['getCategoryLocationLandingBySlugs', 'category'],
  ['getCategorySeoIndex', 'category'],
  ['getRepairCategories', 'category'],
  ['getPublicSiteSettings', 'content'],
  ['getTermsAndConditions', 'content'],
  ['getAboutUs', 'content'],
  ['getFaqs', 'content'],
  ['getIntroduction', 'content'],
  ['getBlogPosts', 'content'],
  ['getBlogPostBySlug', 'content'],
  ['subscribeCustomerClub', 'engagement'],
  ['submitContactMessage', 'engagement'],
  ['buildPwaManifest', 'pwa'],
  ['resolvePwaIconAsset', 'pwa'],
  ['resolveFaviconAsset', 'pwa'],
  ['getPushIconMeta', 'pwa'],
];

const svcType = {
  location: 'CommonLocationService',
  category: 'CommonCategoryService',
  content: 'CommonContentService',
  engagement: 'CommonEngagementService',
  pwa: 'CommonPwaService',
};

const facadeMethods = publicMethods
  .map(([name, svc]) => {
    return `  ${name}(...args: Parameters<${svcType[svc]}['${name}']>) {
    return this.${svc}.${name}(...args);
  }`;
  })
  .join('\n\n');

const facadeFile = `import { Injectable } from '@nestjs/common';
import { CommonLocationService } from './services/common-location.service';
import { CommonCategoryService } from './services/common-category.service';
import { CommonContentService } from './services/common-content.service';
import { CommonEngagementService } from './services/common-engagement.service';
import { CommonPwaService } from './services/common-pwa.service';

/**
 * Backward-compatible facade. Prefer injecting specialized services directly.
 */
@Injectable()
export class CommonService {
  constructor(
    private readonly location: CommonLocationService,
    private readonly category: CommonCategoryService,
    private readonly content: CommonContentService,
    private readonly engagement: CommonEngagementService,
    private readonly pwa: CommonPwaService,
  ) {}

${facadeMethods}
}
`;

const moduleFile = `import { Module } from '@nestjs/common';
import { NotificationModule } from '../modules/notification/notification.module';
import { CommonController } from './common-module.controller';
import { PwaAssetsController } from './pwa-assets.controller';
import { CommonService } from './common-module.service';
import { PwaIconService } from './pwa-icon.service';
import { CommonLocationService } from './services/common-location.service';
import { CommonCategoryService } from './services/common-category.service';
import { CommonContentService } from './services/common-content.service';
import { CommonEngagementService } from './services/common-engagement.service';
import { CommonPwaService } from './services/common-pwa.service';

@Module({
  imports: [NotificationModule],
  controllers: [CommonController, PwaAssetsController],
  providers: [
    CommonLocationService,
    CommonCategoryService,
    CommonContentService,
    CommonEngagementService,
    CommonPwaService,
    CommonService,
    PwaIconService,
  ],
  exports: [PwaIconService, CommonService],
})
export class CommonModuleModule {}
`;

const out = (rel, content) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  console.log('wrote', rel, content.split('\n').length, 'lines');
};

out('src/common-module/services/common-location.service.ts', locationFile);
out('src/common-module/services/common-category.service.ts', categoryFile);
out('src/common-module/services/common-content.service.ts', contentFile);
out('src/common-module/services/common-engagement.service.ts', engagementFile);
out('src/common-module/services/common-pwa.service.ts', pwaFile);
out('src/common-module/common-module.service.ts', facadeFile);
out('src/common-module/common-module.module.ts', moduleFile);

console.log('done');
