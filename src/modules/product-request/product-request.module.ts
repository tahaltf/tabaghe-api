import { Module } from '@nestjs/common';
import { ProductRequestService } from './product-request.service';
import { ProductRequestController } from './product-request.controller';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [PrismaModule, NotificationModule, UsersModule],
  controllers: [ProductRequestController],
  providers: [ProductRequestService],
  exports: [ProductRequestService],
})
export class ProductRequestModule {}
