import { Controller, Get, Header, VERSION_NEUTRAL } from '@nestjs/common';
import { RawResponse } from '../../common/decorators/raw-response.decorator';
import { SitemapService } from './sitemap.service';

@Controller({ version: VERSION_NEUTRAL })
export class SitemapController {
  constructor(private readonly sitemap: SitemapService) {}

  @Get('sitemap.xml')
  @RawResponse()
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  async getSitemap(): Promise<string> {
    const entries = await this.sitemap.buildUrlEntries();
    return this.sitemap.buildSitemapXml(entries);
  }

  @Get('robots.txt')
  @RawResponse()
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=86400')
  getRobots(): string {
    return this.sitemap.buildRobotsTxt();
  }
}
