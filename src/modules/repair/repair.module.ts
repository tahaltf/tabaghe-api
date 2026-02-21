import { Module } from '@nestjs/common';
import { RepairService } from './repair.service';
import { RepairController } from './repair.controller';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [RepairController],
    providers: [RepairService],
})
export class RepairModule {}
