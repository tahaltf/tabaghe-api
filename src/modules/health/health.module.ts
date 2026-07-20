import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller';
import { AuthModule } from '../auth/auth.module';
import { SmsModule } from '../sms/sms.module';

@Module({
  imports: [AuthModule, SmsModule, ConfigModule],
  controllers: [HealthController],
})
export class HealthModule {}
