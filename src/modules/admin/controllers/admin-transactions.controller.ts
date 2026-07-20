import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { AdminTransactionsService } from '../services/admin-transactions.service';
import { AdminTransactionListQueryDto } from '../dto/admin-query.dto';

@Controller('admin/transactions')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('transactions.view')
export class AdminTransactionsController {
  constructor(private readonly service: AdminTransactionsService) {}

  @Get()
  list(@Query() query: AdminTransactionListQueryDto) {
    return this.service.list(query);
  }
}
