import {
  Controller, Patch, Body, Req, UseGuards,
  UseInterceptors, UploadedFile, BadRequestException
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Patch('complete-profile')
  @UseInterceptors(
    FileInterceptor('nationalCardImage', {
      storage: diskStorage({
        destination: './uploads/national-cards',
        filename: (req, file, callback) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          callback(null, `card-${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
    })
  )
  async completeProfile(@Req() req: any, @UploadedFile() file: any, @Body() body: any) {
    if (!file) throw new BadRequestException('تصویر کارت ملی الزامی است');

    return this.usersService.completeProfile(req.user.id, {
      firstName: body.firstName,
      lastName: body.lastName,
      nationalCode: body.nationalCode,
      nationalCardImage: file.path,
    });
  }
}