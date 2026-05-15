import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Patch,
  Post,
  Query,
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
  PanelBadgeSection,
  PanelBadges,
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
  getDashboardStats(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DashboardStats> {
    return this.usersService.getDashboardStats(user.id);
  }

  @Get('panel-badges')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @Header('Pragma', 'no-cache')
  getPanelBadges(
    @CurrentUser() user: AuthenticatedUser,
    @Query('seenListing') seenListing?: string,
    @Query('seenBuy') seenBuy?: string,
    @Query('seenSell') seenSell?: string,
    @Query('seenRequests') seenRequests?: string,
    @Query('seenSupport') seenSupport?: string,
    @Query('seenRepairs') seenRepairs?: string,
  ): Promise<PanelBadges> {
    const parseSeen = (raw?: string): number | undefined => {
      const n = Number(raw ?? '');
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    const seenAtBySection: Partial<Record<PanelBadgeSection, number>> = {};
    const listing = parseSeen(seenListing);
    const buy = parseSeen(seenBuy);
    const sell = parseSeen(seenSell);
    const requests = parseSeen(seenRequests);
    const support = parseSeen(seenSupport);
    const repairs = parseSeen(seenRepairs);
    if (listing) seenAtBySection.listing = listing;
    if (buy) seenAtBySection.buy = buy;
    if (sell) seenAtBySection.sell = sell;
    if (requests) seenAtBySection.requests = requests;
    if (support) seenAtBySection.ticket = support;
    if (repairs) seenAtBySection.repairs = repairs;
    return this.usersService.getPanelBadges(user.id, seenAtBySection);
  }

  @Post('panel-badges/seen')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  markPanelSectionSeen(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { section?: string },
  ): Promise<{ marked: number }> {
    const section = String(body?.section ?? '').trim() as PanelBadgeSection;
    const allowed: PanelBadgeSection[] = [
      'listing',
      'buy',
      'sell',
      'requests',
      'ticket',
      'repairs',
    ];
    if (!allowed.includes(section)) {
      throw new BadRequestException('بخش نامعتبر است');
    }
    return this.usersService.markPanelSectionSeen(user.id, section);
  }

  @Patch('complete-profile')
  @UseInterceptors(
    FileInterceptor('nationalCardImage', nationalCardMulterOptions),
  )
  completeProfile(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CompleteProfileDto,
  ): Promise<MyProfile> {
    return this.usersService.completeProfile(user.id, dto, file?.filename);
  }

  @Patch('settings')
  @UseInterceptors(
    FileInterceptor('nationalCardImage', nationalCardMulterOptions),
  )
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
