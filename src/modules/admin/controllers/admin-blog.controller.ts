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
import { Roles } from '../../auth/decorators/roles.decorator';
import { bannerMulterOptions } from '../../../common/upload/banner-upload.config';
import { AdminBlogService } from '../services/admin-blog.service';
import { AdminCreateBlogPostDto, AdminUpdateBlogPostDto } from '../dto/admin-blog.dto';

@Controller('admin/blog-posts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminBlogController {
  constructor(private readonly service: AdminBlogService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  create(@Body() dto: AdminCreateBlogPostDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: AdminUpdateBlogPostDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post('upload-image')
  @UseInterceptors(FileInterceptor('image', bannerMulterOptions))
  uploadImage(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('فایلی ارسال نشده است');
    return { filename: file.filename, image: `banners/${file.filename}` };
  }
}
