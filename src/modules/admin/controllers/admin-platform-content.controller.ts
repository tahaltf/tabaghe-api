import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { SeedPlatformContentDto } from '../dto/admin-platform-content.dto';
import { AdminPlatformContentService } from '../services/admin-platform-content.service';
import type { AuthenticatedUser } from '../../../shared/contracts/auth';

@Controller('admin/platform-content')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.GODADMIN)
export class AdminPlatformContentController {
  constructor(private readonly content: AdminPlatformContentService) {}

  @Post('seed')
  seedDefaults(
    @Body() dto: SeedPlatformContentDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.content.seedDefaults(
      {
        forceSettings: dto.forceSettings === true,
        forceFaqs: dto.forceFaqs === true,
      },
      req.user.id,
    );
  }
}
