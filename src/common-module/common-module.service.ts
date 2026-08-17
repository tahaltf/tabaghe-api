import { Injectable } from '@nestjs/common';
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

  getProvinces(...args: Parameters<CommonLocationService['getProvinces']>) {
    return this.location.getProvinces(...args);
  }

  getCities(...args: Parameters<CommonLocationService['getCities']>) {
    return this.location.getCities(...args);
  }

  getLocationBySlug(...args: Parameters<CommonLocationService['getLocationBySlug']>) {
    return this.location.getLocationBySlug(...args);
  }

  getLocationLandingBySlug(...args: Parameters<CommonLocationService['getLocationLandingBySlug']>) {
    return this.location.getLocationLandingBySlug(...args);
  }

  getLocationSeoIndex(...args: Parameters<CommonLocationService['getLocationSeoIndex']>) {
    return this.location.getLocationSeoIndex(...args);
  }

  getCategories(...args: Parameters<CommonCategoryService['getCategories']>) {
    return this.category.getCategories(...args);
  }

  getHomeCategories(...args: Parameters<CommonCategoryService['getHomeCategories']>) {
    return this.category.getHomeCategories(...args);
  }

  getCategoryLandingBySlug(...args: Parameters<CommonCategoryService['getCategoryLandingBySlug']>) {
    return this.category.getCategoryLandingBySlug(...args);
  }

  getCategoryLocationLandingBySlugs(...args: Parameters<CommonCategoryService['getCategoryLocationLandingBySlugs']>) {
    return this.category.getCategoryLocationLandingBySlugs(...args);
  }

  getCategorySeoIndex(...args: Parameters<CommonCategoryService['getCategorySeoIndex']>) {
    return this.category.getCategorySeoIndex(...args);
  }

  getRepairCategories(...args: Parameters<CommonCategoryService['getRepairCategories']>) {
    return this.category.getRepairCategories(...args);
  }

  getPublicSiteSettings(...args: Parameters<CommonContentService['getPublicSiteSettings']>) {
    return this.content.getPublicSiteSettings(...args);
  }

  getPublicHomepageLayout(...args: Parameters<CommonContentService['getPublicHomepageLayout']>) {
    return this.content.getPublicHomepageLayout(...args);
  }

  getTermsAndConditions(...args: Parameters<CommonContentService['getTermsAndConditions']>) {
    return this.content.getTermsAndConditions(...args);
  }

  getPrivacyPolicy(...args: Parameters<CommonContentService['getPrivacyPolicy']>) {
    return this.content.getPrivacyPolicy(...args);
  }

  getSellerTerms(...args: Parameters<CommonContentService['getSellerTerms']>) {
    return this.content.getSellerTerms(...args);
  }

  getAboutUs(...args: Parameters<CommonContentService['getAboutUs']>) {
    return this.content.getAboutUs(...args);
  }

  getFaqs(...args: Parameters<CommonContentService['getFaqs']>) {
    return this.content.getFaqs(...args);
  }

  getIntroduction(...args: Parameters<CommonContentService['getIntroduction']>) {
    return this.content.getIntroduction(...args);
  }

  getBlogPosts(...args: Parameters<CommonContentService['getBlogPosts']>) {
    return this.content.getBlogPosts(...args);
  }

  getBlogPostBySlug(...args: Parameters<CommonContentService['getBlogPostBySlug']>) {
    return this.content.getBlogPostBySlug(...args);
  }

  getLandingPageBySlug(...args: Parameters<CommonContentService['getLandingPageBySlug']>) {
    return this.content.getLandingPageBySlug(...args);
  }

  subscribeCustomerClub(...args: Parameters<CommonEngagementService['subscribeCustomerClub']>) {
    return this.engagement.subscribeCustomerClub(...args);
  }

  submitContactMessage(...args: Parameters<CommonEngagementService['submitContactMessage']>) {
    return this.engagement.submitContactMessage(...args);
  }

  buildPwaManifest(...args: Parameters<CommonPwaService['buildPwaManifest']>) {
    return this.pwa.buildPwaManifest(...args);
  }

  resolvePwaIconAsset(...args: Parameters<CommonPwaService['resolvePwaIconAsset']>) {
    return this.pwa.resolvePwaIconAsset(...args);
  }

  resolveFaviconAsset(...args: Parameters<CommonPwaService['resolveFaviconAsset']>) {
    return this.pwa.resolveFaviconAsset(...args);
  }

  getPushIconMeta(...args: Parameters<CommonPwaService['getPushIconMeta']>) {
    return this.pwa.getPushIconMeta(...args);
  }
}
