import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserPanelAccessGuard } from '../auth/guards/user-panel-access.guard';
import { RequirePanelAccess } from '../auth/decorators/require-panel-access.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../shared/contracts/auth';
import { ProductRequestService } from './product-request.service';
import { SubmitProductRequestDto } from './dto/product-request.dto';

@Controller('product-requests')
@UseGuards(JwtAuthGuard)
export class ProductRequestController {
  constructor(private readonly service: ProductRequestService) {}

  @Post()
  @UseGuards(UserPanelAccessGuard)
  @RequirePanelAccess('dashboard.productRequests')
  @Throttle({ default: { limit: 8, ttl: 10 * 60_000 } })
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitProductRequestDto,
  ) {
    return this.service.submit(user.id, dto);
  }
}
