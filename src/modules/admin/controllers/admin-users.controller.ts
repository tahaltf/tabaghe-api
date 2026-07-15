import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  ParseIntPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import { nationalCardMulterOptions } from '../../../common/upload/national-card-upload.config';
import { validateUploadedFileSignature } from '../../../common/upload/validate-uploaded-file.util';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AdminUsersQueryService } from '../services/admin-users-query.service';
import { AdminUserListQueryDto } from '../dto/admin-query.dto';
import { TokenService } from '../../auth/services/token.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AdminSetUserPasswordDto } from '../dto/admin-user-password.dto';
import { AdminSetUserActivationDto } from '../dto/admin-user-activation.dto';
import { AdminSetUserRatingDto } from '../dto/admin-user-rating.dto';
import { AdminSetUserTrustScoreDto } from '../dto/admin-user-trust-score.dto';
import { AdminSetUserApprovedDto } from '../dto/admin-user-approved.dto';
import { AdminCreateUserDto } from '../dto/admin-create-user.dto';
import { AdminUpdateUserProfileDto } from '../dto/admin-update-user-profile.dto';
import { AuthenticatedUser } from '../../../shared/contracts/auth';

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
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: AdminUserListQueryDto,
  ) {
    return this.service.list(actor, query);
  }

  @Get(':id')
  detail(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.service.detail(actor, id);
  }

  @Get(':id/activities')
  activities(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.service.activities(actor, id, limit);
  }

  @Get(':id/login-logs')
  loginLogs(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.service.loginLogs(actor, id, limit);
  }

  @Get(':id/rating-history')
  ratingHistory(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.service.ratingHistory(actor, id, limit);
  }

  @Patch(':id/toggle-role')
  toggleRole(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.service.toggleRole(actor, id);
  }

  @Patch(':id/profile')
  @UseInterceptors(
    FileInterceptor('nationalCardImage', nationalCardMulterOptions),
  )
  updateProfile(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdminUpdateUserProfileDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    validateUploadedFileSignature(file, ['jpeg', 'png', 'webp'], 'تصویر کارت ملی');
    return this.service.updateUserProfile(actor, id, dto, file?.filename);
  }

  @Patch(':id/password')
  setPassword(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdminSetUserPasswordDto,
  ) {
    return this.service.setUserPassword(actor, id, dto.password);
  }

  @Patch(':id/activation')
  setActivation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdminSetUserActivationDto,
  ) {
    return this.service.setUserActivation(actor, id, dto.isActive);
  }

  @Patch(':id/approved')
  setApproved(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdminSetUserApprovedDto,
  ) {
    return this.service.setUserApproved(actor, id, dto.isApproved);
  }

  @Patch(':id/rating')
  setRating(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdminSetUserRatingDto,
  ) {
    return this.service.setUserRating(actor, id, dto.rating);
  }

  @Patch(':id/trust-score')
  setTrustScore(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdminSetUserTrustScoreDto,
  ) {
    return this.service.setUserTrustScore(actor, id, dto.trustScore);
  }

  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: AdminCreateUserDto,
  ) {
    return this.service.createUser(actor, dto);
  }

  @Get(':id/plan')
  getUserPlan(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.service.getUserPlanInfo(actor, id);
  }

  @Patch(':id/plan')
  setUserPlan(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { planId?: string },
  ) {
    if (
      !body?.planId ||
      typeof body.planId !== 'string' ||
      !body.planId.trim()
    ) {
      throw new BadRequestException('شناسه پلن الزامی است');
    }
    return this.service.assignPlanToUser(actor, id, body.planId.trim());
  }

  @Delete(':id/plan')
  cancelUserPlan(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.service.cancelActiveUserPlan(actor, id);
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
        id: true,
        phone: true,
        role: true,
        status: true,
        isVerified: true,
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
