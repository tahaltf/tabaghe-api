import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { AdminCrawlerService } from '../services/admin-crawler.service';
import {
  CrawlerCodeDto,
  CrawlerPhoneDto,
  CrawlerSettingsDto,
} from '../dto/admin-crawler.dto';

@Controller('admin/crawler')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.GODADMIN)
export class AdminCrawlerController {
  constructor(private readonly crawler: AdminCrawlerService) {}

  @Get('status')
  getStatus() {
    return this.crawler.getStatus();
  }

  @Get('settings')
  getSettings() {
    return this.crawler.getSettings();
  }

  @Put('settings')
  saveSettings(@Body() body: CrawlerSettingsDto) {
    return this.crawler.saveSettings(body);
  }

  @Get('session')
  getSession() {
    return this.crawler.getSession();
  }

  @Post('auth/request-otp')
  requestOtp(@Body() body: CrawlerPhoneDto) {
    return this.crawler.requestOtp(body.phone);
  }

  @Post('auth/verify')
  verifyOtp(@Body() body: CrawlerCodeDto) {
    return this.crawler.verifyOtp(body.code);
  }

  @Post('auth/sync')
  syncAuth() {
    return this.crawler.syncAuth();
  }

  @Post('auth/logout')
  logout() {
    return this.crawler.logout();
  }

  @Post('start')
  start() {
    return this.crawler.startCrawler();
  }

  @Post('stop')
  stop() {
    return this.crawler.stopCrawler();
  }

  @Post('otp')
  submitOtp(@Body() body: CrawlerCodeDto) {
    return this.crawler.submitCrawlOtp(body.code);
  }

  @Get('records')
  getRecords(@Query('filter') filter = 'all') {
    return this.crawler.getRecords(filter);
  }

  @Get('phones')
  getPhones() {
    return this.crawler.getPhones();
  }

  @Get('export/phones')
  exportPhones(@Res() res: Response) {
    return this.crawler.streamPhonesExport(res);
  }
}
