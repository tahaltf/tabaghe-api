import { Controller, Get, Param } from '@nestjs/common';
import { CommonService } from "./common-module.service";

@Controller('common')
export class CommonController {
  constructor(private readonly commonService: CommonService) {}

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
}