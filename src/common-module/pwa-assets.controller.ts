import {
  Controller,
  Get,
  Header,
  NotFoundException,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { createReadStream } from 'fs';
import { StreamableFile } from '@nestjs/common';
import { RawResponse } from '../common/decorators/raw-response.decorator';
import { CommonService } from './common-module.service';

@Controller({ version: VERSION_NEUTRAL })
export class PwaAssetsController {
  constructor(private readonly commonService: CommonService) {}

  @Get('manifest.webmanifest')
  @RawResponse()
  @Header('Content-Type', 'application/manifest+json; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=600')
  async manifest(): Promise<Record<string, unknown>> {
    return this.commonService.buildPwaManifest();
  }
}
