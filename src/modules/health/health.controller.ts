import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RawResponse } from '../../common/decorators/raw-response.decorator';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RawResponse()
  async health() {
    // DB ping
    await this.prisma.$queryRaw`SELECT 1`;

    return {
      ok: true,
      status: 'up',
      time: new Date().toISOString(),
    };
  }
}
