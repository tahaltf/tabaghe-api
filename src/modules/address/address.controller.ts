import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@Controller('addresses')
@UseGuards(JwtAuthGuard)
export class AddressController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async getMyAddresses(@Req() req) {
    return this.prisma.address.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' }
    });
  }

  @Post()
  async createAddress(@Req() req, @Body() dto: any) {
    return this.prisma.address.create({
      data: {
        userId: req.user.id,
        title: dto.title,
        province: dto.province,
        city: dto.city,
        fullAddress: dto.fullAddress,
        postalCode: dto.postalCode,
        phone: dto.phone
      }
    });
  }
}