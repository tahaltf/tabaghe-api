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
import { Roles } from '../../auth/decorators/roles.decorator';
import { bannerMulterOptions } from '../../../common/upload/banner-upload.config';
import { AdminLandingPagesService } from '../services/admin-landing-pages.service';
import {
  AdminCreateLandingPageDto,
  AdminUpdateLandingPageDto,
} from '../dto/admin-landing-page.dto';

@Controller('admin/landing-pages')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminLandingPagesController {
  constructor(private readonly service: AdminLandingPagesService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post('upload-media')
  @UseInterceptors(FileInterceptor('image', bannerMulterOptions))
  uploadMedia(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('فایلی ارسال نشده است');
    return { filename: file.filename, image: `banners/${file.filename}` };
  }

  @Post()
  create(@Body() dto: AdminCreateLandingPageDto, @Req() req: Request) {
    const userId = (req as Request & { user?: { id?: string } }).user?.id;
    return this.service.create(dto, userId);
  }

  @Post('seed-seller')
  seedSeller(@Body() body?: { force?: boolean }) {
    return this.service.seedSellerLanding(body?.force ?? false);
  }

  @Post('seed-invite')
  seedInvite(@Body() body?: { force?: boolean }) {
    return this.service.seedInviteLanding(body?.force ?? false);
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: AdminUpdateLandingPageDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/duplicate')
  duplicate(@Param('id') id: string, @Req() req: Request) {
    const userId = (req as Request & { user?: { id?: string } }).user?.id;
    return this.service.duplicate(id, userId);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
