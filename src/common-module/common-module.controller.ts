import { Body, Controller, Get, Param, Post, Req, StreamableFile } from '@nestjs/common';
import type { Request } from 'express';
import { createReadStream } from 'fs';
import { CommonService } from './common-module.service';
import { buildClientNetworkHint } from './client-network-hint.util';

@Controller('common')
export class CommonController {
  constructor(private readonly commonService: CommonService) {}

  /**
   * کشور اتصال از هدرهای لبه (مثل Cloudflare) — بدون سرویس Geo خارجی.
   * برای nginx می‌توان هدر `X-Tabaghe-Client-Country` را با geoip2 پر کرد.
   */
  @Get('client-network')
  clientNetwork(@Req() req: Request) {
    return buildClientNetworkHint(req);
  }

  @Get('provinces')
  async provinces() {
    return this.commonService.getProvinces();
  }

  @Get('cities/:provinceId')
  async cities(@Param('provinceId') provinceId: string) {
    return this.commonService.getCities(provinceId);
  }

  @Get('categories')
  async categories() {
    return this.commonService.getCategories();
  }

  @Get('categories/home')
  async homeCategories() {
    return this.commonService.getHomeCategories();
  }

  @Get('categories/seo-index')
  async categorySeoIndex() {
    return this.commonService.getCategorySeoIndex();
  }

  @Get('categories/slug/:slug/location/:locationSlug')
  async categoryBySlugAndLocation(
    @Param('slug') slug: string,
    @Param('locationSlug') locationSlug: string,
  ) {
    const data = await this.commonService.getCategoryLocationLandingBySlugs(
      slug,
      locationSlug,
    );
    if (!data) {
      return { found: false };
    }
    return { found: true, ...data };
  }

  @Get('categories/slug/:slug')
  async categoryBySlug(@Param('slug') slug: string) {
    const data = await this.commonService.getCategoryLandingBySlug(slug);
    if (!data) {
      return { found: false };
    }
    return { found: true, ...data };
  }

  @Get('repair-categories')
  async repairCategories() {
    return this.commonService.getRepairCategories();
  }

  @Get('site-settings')
  async siteSettings() {
    return this.commonService.getPublicSiteSettings();
  }

  /** آیکن PWA / apple-touch-icon — لوگوی تم روشن ادمین */
  @Get('pwa-icon')
  async pwaIcon(): Promise<StreamableFile> {
    const asset = await this.commonService.resolvePwaIconAsset();
    if (!asset) {
      throw new NotFoundException('آیکن PWA یافت نشد');
    }
    return new StreamableFile(createReadStream(asset.path), {
      type: asset.mime,
      disposition: 'inline',
    });
  }

  @Get('terms')
  async terms() {
    return this.commonService.getTermsAndConditions();
  }

  @Get('about')
  async about() {
    return this.commonService.getAboutUs();
  }

  @Get('faqs')
  async faqs() {
    return this.commonService.getFaqs();
  }

  @Get('introduction')
  async introduction() {
    return this.commonService.getIntroduction();
  }

  @Get('blog-posts')
  async blogPosts() {
    return this.commonService.getBlogPosts();
  }

  @Get('blog-posts/:slug')
  async blogPost(@Param('slug') slug: string) {
    return this.commonService.getBlogPostBySlug(slug);
  }

  @Post('contact-us')
  async submitContact(
    @Body()
    body: {
      name: string;
      phone: string;
      email?: string;
      subject: string;
      message: string;
    },
  ) {
    return this.commonService.submitContactMessage(body);
  }

  @Post('customer-club')
  async subscribeCustomerClub(@Body() body: { contact: string }) {
    return this.commonService.subscribeCustomerClub(body.contact);
  }
}
