import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Req } from '@nestjs/common';
import { AddressService } from './address.service';
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@Controller('addresses')
@UseGuards(JwtAuthGuard)
export class AddressController {
  constructor(private readonly addressService: AddressService) {}

  @Get()
  async getMyAddresses(@Req() req) {
    return this.addressService.getMyAddresses(req.user.id);
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