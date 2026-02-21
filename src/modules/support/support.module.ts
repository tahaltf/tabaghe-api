import { Module } from '@nestjs/common';
import { SupportService } from './support.service';
import { SupportController } from './support.controller'; // 👈 اضافه شود
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Module({
  controllers: [SupportController], // 👈 حتماً اینجا باشد
  providers: [SupportService, PrismaService],
})
export class SupportModule {}