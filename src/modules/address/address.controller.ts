import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AddressService } from './address.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LookupPostalCodeDto } from './dto/lookup-postal-code.dto';
import { extractClientIp } from '../../common/http/client-ip.util';

@Controller('addresses')
@UseGuards(JwtAuthGuard)
export class AddressController {
  constructor(private readonly addressService: AddressService) {}

  @Get('inquiry-config')
  getInquiryConfig() {
    return this.addressService.getInquiryConfig();
  }

  @Get()
  async getMyAddresses(@Req() req) {
    return this.addressService.getMyAddresses(req.user.id);
  }

  @Post('lookup-postal-code')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  lookupPostalCode(@Req() req, @Body() dto: LookupPostalCodeDto) {
    return this.addressService.lookupPostalCode(
      dto.postalCode,
      req.user?.id,
      extractClientIp(req),
    );
  }

  @Post()
  async createAddress(@Req() req, @Body() dto: any) {
    return this.addressService.createAddress(req.user.id, dto);
  }

  @Patch(':id')
  async updateAddress(@Req() req, @Param('id') id: string, @Body() dto: any) {
    return this.addressService.updateAddress(req.user.id, id, dto);
  }

  @Delete(':id')
  async deleteAddress(@Req() req, @Param('id') id: string) {
    return this.addressService.deleteAddress(req.user.id, id);
  }
}
