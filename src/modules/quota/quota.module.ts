import { Module } from '@nestjs/common';
import { QuotaService } from './quota.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [QuotaService],
  exports: [QuotaService],
})
export class QuotaModule {}
