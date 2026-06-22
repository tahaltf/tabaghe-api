import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { RawResponse } from '../../common/decorators/raw-response.decorator';
import {
  SitemapPartId,
  SitemapService,
} from './sitemap.service';

@Controller({ version: VERSION_NEUTRAL })
export class SitemapController {
  constructor(private readonly sitemap: SitemapService) {}

  @Get('sitemap.xml')
  @RawResponse()
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  async getSitemapIndex(): Promise<string> {
    return this.sitemap.buildSitemapIndexXml();
  }

  @Get('sitemap-:part.xml')
  @RawResponse()
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  async getSitemapPart(@Param('part') part: string): Promise<string> {
    const allowed = this.sitemap.listSitemapPartIds();
    if (!allowed.includes(part as SitemapPartId)) {
      throw new NotFoundException();
    }
    return this.sitemap.buildPartXml(part as SitemapPartId);
  }

  @Get('robots.txt')
  @RawResponse()
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=86400')
  getRobots(): string {
    return this.sitemap.buildRobotsTxt();
  }
}
