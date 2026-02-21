import { Module } from '@nestjs/common';
import { UsersController } from './UsersController';
import { AdminUsersController } from './admin.controller'; // 👈 ایمپورت کنترلر ادمین
import { UsersService } from './users.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Module({
  controllers: [
    UsersController,
    AdminUsersController // 👈 اضافه شدن به لیست کنترلرها
  ],
  providers: [UsersService, PrismaService],
  exports: [UsersService], // 👈 خیلی مهم
})
export class UsersModule {}