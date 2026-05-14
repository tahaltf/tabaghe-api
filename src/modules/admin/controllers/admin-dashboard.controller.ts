import {
  BadRequestException,
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  AdminDashboardService,
  DashboardWindow,
  ProfitRange,
} from '../services/admin-dashboard.service';

const VALID_RANGES: ProfitRange[] = [
  'today',
  '7d',
  '30d',
  '90d',
  '365d',
  'all',
];
const VALID_WINDOWS: DashboardWindow[] = ['day', 'week', 'year'];

@Controller('admin/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminDashboardController {
  constructor(private readonly service: AdminDashboardService) {}

  @Get('stats')
  stats() {
    return this.service.getStats();
  }

  @Get('revenue-timeseries')
  revenueTimeseries(
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
  ) {
    return this.service.getRevenueTimeseries(days);
  }

  @Get('profit')
  profit(@Query('range') range?: string) {
    const r = (range ?? '30d') as ProfitRange;
    if (!VALID_RANGES.includes(r)) {
      throw new BadRequestException('بازه زمانی نامعتبر است');
    }
    return this.service.getProfit(r);
  }

  @Get('kpis')
  kpis(@Query('window') window?: string) {
    const w = (window ?? 'week') as DashboardWindow;
    if (!VALID_WINDOWS.includes(w)) {
      throw new BadRequestException('بازه KPI نامعتبر است');
    }
    return this.service.getKpisByWindow(w);
  }
}
