import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../shared/contracts/auth';
import { RecordPageviewDto } from '../dto/pageview.dto';
import { SitePageviewService } from '../services/site-pageview.service';

@Controller('analytics')
export class PageviewController {
  constructor(private readonly pageviews: SitePageviewService) {}

  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 300 } })
  @Post('pageview')
  record(
    @Body() body: RecordPageviewDto,
    @CurrentUser() user: AuthenticatedUser | null,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.pageviews.record(body, user?.id, userAgent);
  }
}
