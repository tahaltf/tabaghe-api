import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';
import { FeesModule } from '../fees/fees.module';

// Controllers
import { AdminDashboardController } from './controllers/admin-dashboard.controller';
import { AdminUsersQueryController } from './controllers/admin-users.controller';
import { AdminListingsQueryController } from './controllers/admin-listings.controller';
import { AdminOrdersQueryController } from './controllers/admin-orders.controller';
import { AdminTransactionsController } from './controllers/admin-transactions.controller';
import { AdminCategoriesController } from './controllers/admin-categories.controller';
import { AdminLocationsController } from './controllers/admin-locations.controller';
import { AdminSettingsController } from './controllers/admin-settings.controller';
import { AdminPlansController } from './controllers/admin-plans.controller';
import { AdminFeeRulesController } from './controllers/admin-fee-rules.controller';
import { AdminRepairsController } from './controllers/admin-repairs.controller';
import { AdminTicketsController } from './controllers/admin-tickets.controller';
import { AdminNotificationsController } from './controllers/admin-notifications.controller';
import { AdminDisputesController } from './controllers/admin-disputes.controller';
import { AdminFaqController } from './controllers/admin-faq.controller';
import { AdminSmsController } from './controllers/admin-sms.controller';
import { AdminLogsController } from './controllers/admin-logs.controller';
import { AdminPlatformWalletController } from './controllers/admin-platform-wallet.controller';

// Services
import { AdminDashboardService } from './services/admin-dashboard.service';
import { AdminUsersQueryService } from './services/admin-users-query.service';
import { AdminListingsQueryService } from './services/admin-listings-query.service';
import { AdminOrdersQueryService } from './services/admin-orders-query.service';
import { AdminOrdersCommandService } from './services/admin-orders-command.service';
import { AdminTransactionsService } from './services/admin-transactions.service';
import { AdminCategoriesService } from './services/admin-categories.service';
import { AdminLocationsService } from './services/admin-locations.service';
import { AdminSettingsService } from './services/admin-settings.service';
import { AdminPlansService } from './services/admin-plans.service';
import { AdminFeeRulesService } from './services/admin-fee-rules.service';
import { AdminRepairsService } from './services/admin-repairs.service';
import { AdminTicketsService } from './services/admin-tickets.service';
import { AdminDisputesService } from './services/admin-disputes.service';
import { AdminFaqService } from './services/admin-faq.service';
import { AdminSmsService } from './services/admin-sms.service';
import { AdminLogsService } from './services/admin-logs.service';
import { AdminPlatformWalletService } from './services/admin-platform-wallet.service';
import { SmsService } from '../sms/sms.service';

@Module({
  imports: [PrismaModule, AuthModule, NotificationModule, FeesModule],
  controllers: [
    AdminDashboardController,
    AdminUsersQueryController,
    AdminListingsQueryController,
    AdminOrdersQueryController,
    AdminTransactionsController,
    AdminCategoriesController,
    AdminLocationsController,
    AdminSettingsController,
    AdminPlansController,
    AdminFeeRulesController,
    AdminRepairsController,
    AdminTicketsController,
    AdminNotificationsController,
    AdminDisputesController,
    AdminFaqController,
    AdminSmsController,
    AdminLogsController,
    AdminPlatformWalletController,
  ],
  providers: [
    AdminDashboardService,
    AdminUsersQueryService,
    AdminListingsQueryService,
    AdminOrdersQueryService,
    AdminOrdersCommandService,
    AdminTransactionsService,
    AdminCategoriesService,
    AdminLocationsService,
    AdminSettingsService,
    AdminPlansService,
    AdminFeeRulesService,
    AdminRepairsService,
    AdminTicketsService,
    AdminDisputesService,
    AdminFaqService,
    AdminSmsService,
    AdminLogsService,
    AdminPlatformWalletService,
    SmsService,
  ],
})
export class AdminModule {}
