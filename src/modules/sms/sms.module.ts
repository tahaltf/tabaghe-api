import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SmsService } from './sms.service';
import { SmsIrProvider } from './gateways/smsir.provider';
import { KavenegarProvider } from './gateways/kavenegar.provider';

@Module({
  imports: [ConfigModule],
  providers: [SmsService, SmsIrProvider, KavenegarProvider],
  exports: [SmsService],
})
export class SmsModule {}
