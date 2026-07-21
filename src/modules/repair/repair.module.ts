import { Module } from '@nestjs/common';
import { RepairService } from './repair.service';
import { RepairController } from './repair.controller';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { PaymentsModule } from '../payments/payments.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [PrismaModule, NotificationModule, PaymentsModule, UsersModule],
  controllers: [RepairController],
  providers: [RepairService],
})
export class RepairModule {}
