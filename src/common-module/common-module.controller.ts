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
}