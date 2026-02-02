import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserStatus } from '@prisma/client';
import { UpdateSettingsDto } from './dto/update-settings.dto'; // مطمئن شوید مسیر فایل درست است
@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async completeProfile(
    userId: string,
    data: {
      firstName: string;
      lastName: string;
      nationalCode: string;
      nationalCardImage: string;
    },
  ) {
    const existingUser = await this.prisma.user.findFirst({
      where: {
        nationalCode: data.nationalCode,
        NOT: { id: userId },
      },
    });

    if (existingUser) {
      throw new BadRequestException('کد ملی وارد شده قبلاً ثبت شده است.');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        nationalCode: data.nationalCode,
        nationalCardImage: data.nationalCardImage,
        status: UserStatus.PENDING,
      },
    });
  }
  async updateSettings(userId: string, dto: UpdateSettingsDto) {
    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          bio: dto.bio,
          avatar: dto.avatar,
          nationalCardImage: dto.nationalCardImage,
          notifyEmail: String(dto.notifyEmail) === 'true',
          notifySms: String(dto.notifySms) === 'true',
          notifyPush: String(dto.notifyPush) === 'true',
        },
        select: {
          id: true, phone: true, email: true, firstName: true, lastName: true,
          avatar: true, bio: true, nationalCardImage: true, notifyPush: true,notifyEmail: true,notifySms: true
        }
      });
    } catch (error) {
      if (error.code === 'P2002') {
        throw new BadRequestException('این ایمیل قبلاً ثبت شده است.');
      }
      throw error;
    }
  }
}
