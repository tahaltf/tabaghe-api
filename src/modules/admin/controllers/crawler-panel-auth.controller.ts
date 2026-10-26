import { Body, Controller, Headers, Post } from '@nestjs/common';
import { CrawlerPanelLoginDto } from '../dto/admin-crawler-panel-user.dto';
import { AdminCrawlerPanelUsersService } from '../services/admin-crawler-panel-users.service';

/**
 * Called by crawler.tabagheh.com /gate — not for browser admins.
 * Secured with shared secret header X-Crawler-Gate-Key.
 */
@Controller('crawler-panel')
export class CrawlerPanelAuthController {
  constructor(private readonly users: AdminCrawlerPanelUsersService) {}

  @Post('auth/login')
  async login(
    @Headers('x-crawler-gate-key') gateKey: string | undefined,
    @Body() dto: CrawlerPanelLoginDto,
  ) {
    this.users.assertGateSecret(gateKey);
    return this.users.verifyLogin(dto.username, dto.password);
  }
}
