import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { bannerMulterOptions } from '../../../common/upload/banner-upload.config';
import { ImageOptimizeService } from '../../../common/upload/image-optimize.service';
import { AdminBlogService } from '../services/admin-blog.service';
import {
  AdminCreateBlogPostDto,
  AdminUpdateBlogPostDto,
} from '../dto/admin-blog.dto';

@Controller('admin/blog-posts')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('blog.view')
export class AdminBlogController {
  constructor(
    private readonly service: AdminBlogService,
    private readonly imageOptimize: ImageOptimizeService,
  ) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  @RequirePermission('blog.create')
  create(@Body() dto: AdminCreateBlogPostDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermission('blog.update')
  update(@Param('id') id: string, @Body() dto: AdminUpdateBlogPostDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('blog.delete')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post('upload-image')
  @RequirePermission('blog.create')
  @UseInterceptors(FileInterceptor('image', bannerMulterOptions))
  async uploadImage(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('فایلی ارسال نشده است');
    const optimized = await this.imageOptimize.optimizeContentUpload(file);
    return {
      filename: optimized.filename,
      image: `banners/${optimized.filename}`,
    };
  }
}
