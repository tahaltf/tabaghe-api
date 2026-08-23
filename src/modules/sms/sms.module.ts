import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SmsService } from './sms.service';
import { SmsIrProvider } from './gateways/smsir.provider';
import { KavenegarProvider } from './gateways/kavenegar.provider';
import { SmsIrApiClient } from './gateways/smsir-api.client';

@Module({
  imports: [ConfigModule],
  providers: [SmsService, SmsIrProvider, KavenegarProvider, SmsIrApiClient],
  exports: [SmsService, SmsIrApiClient],
})
export class SmsModule {}
