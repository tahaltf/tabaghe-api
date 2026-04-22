import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { AdminUsersQueryService } from '../services/admin-users-query.service';
import { AdminUserListQueryDto } from '../dto/admin-query.dto';
import { TokenService } from '../../auth/services/token.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminUsersQueryController {
  constructor(
    private readonly service: AdminUsersQueryService,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  list(@Query() query: AdminUserListQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Patch(':id/toggle-role')
  toggleRole(@Param('id') id: string) {
    return this.service.toggleRole(id);
  }

  /**
   * Admin impersonation: returns a token pair for the target user.
   * Used by the admin panel's "Login as user" button.
   */
  @Post(':id/impersonate')
  async impersonate(@Param('id') id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true, phone: true, role: true, status: true, isVerified: true,
      },
    });
    if (!user) throw new NotFoundException('کاربر پیدا نشد');
    const pair = this.tokens.signPair({
      sub: user.id,
      phone: user.phone,
      role: user.role,
      status: user.status,
      isVerified: user.isVerified,
    });
    return { ...pair, user };
  }
}
