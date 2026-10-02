import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { bannerMulterOptions } from '../../../common/upload/banner-upload.config';
import { AdminLandingPagesService } from '../services/admin-landing-pages.service';
import {
  AdminCreateLandingPageDto,
  AdminUpdateLandingPageDto,
} from '../dto/admin-landing-page.dto';

@Controller('admin/landing-pages')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('landing_pages.view')
export class AdminLandingPagesController {
  constructor(private readonly service: AdminLandingPagesService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post('upload-media')
  @RequirePermission('landing_pages.create')
  @UseInterceptors(FileInterceptor('image', bannerMulterOptions))
  uploadMedia(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('فایلی ارسال نشده است');
    return { filename: file.filename, image: `banners/${file.filename}` };
  }

  @Post()
  @RequirePermission('landing_pages.create')
  create(@Body() dto: AdminCreateLandingPageDto, @Req() req: Request) {
    const userId = (req as Request & { user?: { id?: string } }).user?.id;
    return this.service.create(dto, userId);
  }

  @Post('seed-seller')
  @RequirePermission('landing_pages.create')
  seedSeller(@Body() body?: { force?: boolean }) {
    return this.service.seedSellerLanding(body?.force ?? false);
  }

  @Post('seed-buyer')
  @RequirePermission('landing_pages.create')
  seedBuyer(@Body() body?: { force?: boolean }) {
    return this.service.seedBuyerLanding(body?.force ?? false);
  }

  @Post('seed-invite')
  @RequirePermission('landing_pages.create')
  seedInvite(@Body() body?: { force?: boolean }) {
    return this.service.seedInviteLanding(body?.force ?? false);
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Patch(':id')
  @RequirePermission('landing_pages.update')
  update(@Param('id') id: string, @Body() dto: AdminUpdateLandingPageDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/duplicate')
  @RequirePermission('landing_pages.create')
  duplicate(@Param('id') id: string, @Req() req: Request) {
    const userId = (req as Request & { user?: { id?: string } }).user?.id;
    return this.service.duplicate(id, userId);
  }

  @Delete(':id')
  @RequirePermission('landing_pages.delete')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
