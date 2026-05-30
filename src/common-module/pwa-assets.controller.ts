import {
  Controller,
  Get,
  Header,
  Res,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import type { Response } from 'express';
import { RawResponse } from '../common/decorators/raw-response.decorator';
import { CommonService } from './common-module.service';
import { PwaIconService } from './pwa-icon.service';

@Controller({ version: VERSION_NEUTRAL })
export class PwaAssetsController {
  constructor(
    private readonly commonService: CommonService,
    private readonly pwaIconService: PwaIconService,
  ) {}

  @Get('manifest.webmanifest')
  @RawResponse()
  @Header('Content-Type', 'application/manifest+json; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=600')
  async manifest(): Promise<Record<string, unknown>> {
    return this.commonService.buildPwaManifest();
  }

  @Get('pwa/apple-touch-icon.png')
  async appleTouchIcon(@Res() res: Response): Promise<void> {
    await this.sendPng(res, 180);
  }

  @Get('pwa/icon-192.png')
  async icon192(@Res() res: Response): Promise<void> {
    await this.sendPng(res, 192);
  }

  @Get('pwa/icon-512.png')
  async icon512(@Res() res: Response): Promise<void> {
    await this.sendPng(res, 512);
  }

  /** سازگاری با مسیر قبلی */
  @Get('pwa/icon')
  async iconLegacy(@Res() res: Response): Promise<void> {
    await this.sendPng(res, 512);
  }

  /** favicon تب مرورگر — لوگوی تم تاریک (سفید)، پس‌زمینه شفاف */
  @Get('pwa/favicon.png')
  async favicon(@Res() res: Response): Promise<void> {
    const buf = await this.pwaIconService.getFaviconPngBuffer(32);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
    res.send(buf);
  }

  @Get('favicon.ico')
  async faviconIco(@Res() res: Response): Promise<void> {
    const buf = await this.pwaIconService.getFaviconPngBuffer(32);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
    res.send(buf);
  }

  private async sendPng(res: Response, size: number): Promise<void> {
    const buf = await this.pwaIconService.getPngBuffer(size);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
    res.send(buf);
  }
}
