import { Module } from '@nestjs/common';
import { UsersController } from './UsersController';
import { UsersService } from './users.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [UsersController], // اضافه شد
  providers: [UsersService, PrismaService],
  exports: [UsersService], // 👈 خیلی مهم
})
export class UsersModule {}
