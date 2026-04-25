import {
  Body,
  Controller,
  Get,
  Header,
  Patch,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../../shared/contracts/auth';
import { nationalCardMulterOptions } from '../../common/upload/national-card-upload.config';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import {
  DashboardStats,
  MyProfile,
  UsersService,
} from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@CurrentUser() user: AuthenticatedUser): Promise<MyProfile> {
    return this.usersService.getMe(user.id);
  }

  @Get('dashboard-stats')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @Header('Pragma', 'no-cache')
  getDashboardStats(@CurrentUser() user: AuthenticatedUser): Promise<DashboardStats> {
    return this.usersService.getDashboardStats(user.id);
  }

  @Patch('complete-profile')
  @UseInterceptors(FileInterceptor('nationalCardImage', nationalCardMulterOptions))
  completeProfile(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CompleteProfileDto,
  ): Promise<MyProfile> {
    return this.usersService.completeProfile(user.id, dto, file?.filename);
  }

  @Patch('settings')
  @UseInterceptors(FileInterceptor('nationalCardImage', nationalCardMulterOptions))
  updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateSettingsDto,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<MyProfile> {
    return this.usersService.updateSettings(user.id, dto, file?.filename);
  }

  @Patch('accept-terms')
  acceptTerms(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<MyProfile> {
    return this.usersService.acceptTerms(
      user.id,
      req.ip,
      String(req.headers['user-agent'] ?? ''),
    );
  }
}
