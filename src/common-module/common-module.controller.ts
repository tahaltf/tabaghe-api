import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
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

  @Get('repair-categories')
  async repairCategories() {
    return this.commonService.getRepairCategories();
  }

  @Get('site-settings')
  async siteSettings() {
    return this.commonService.getPublicSiteSettings();
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
}
