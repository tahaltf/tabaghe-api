import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CommonService } from './common-module.service';
import { PwaIconService } from './pwa-icon.service';
import { buildClientNetworkHint } from './client-network-hint.util';
import { CacheControl } from '../common/decorators/cache-control.decorator';

@Controller('common')
@CacheControl('public, max-age=120, stale-while-revalidate=300')
export class CommonController {
  constructor(
    private readonly commonService: CommonService,
    private readonly pwaIconService: PwaIconService,
  ) {}

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

  @Get('locations/slug/:slug')
  async locationBySlug(@Param('slug') slug: string) {
    const location = await this.commonService.getLocationBySlug(slug);
    if (!location) {
      throw new NotFoundException();
    }
    return location;
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

  /** آیکن PWA — PNG رستری از لوگوی تم روشن (مناسب iOS) */
  @Get('pwa-icon')
  async pwaIcon(@Res() res: Response): Promise<void> {
    const buf = await this.pwaIconService.getPngBuffer(512);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buf);
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

  @Get('landing-pages/:slug')
  async landingPage(@Param('slug') slug: string) {
    const page = await this.commonService.getLandingPageBySlug(slug);
    if (!page) {
      throw new NotFoundException();
    }
    return page;
  }

  @Post('contact-us')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
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
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async subscribeCustomerClub(@Body() body: { contact: string }) {
    return this.commonService.subscribeCustomerClub(body.contact);
  }
}
