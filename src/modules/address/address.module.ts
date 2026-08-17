import { Module } from '@nestjs/common';
import { AddressService } from './address.service';
import { AddressController } from './address.controller';
import { ZohalModule } from '../zohal/zohal.module';

@Module({
  imports: [ZohalModule],
  controllers: [AddressController],
  providers: [AddressService],
})
export class AddressModule {}
