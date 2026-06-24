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
import { AdminContactMessagesController } from './controllers/admin-contact-messages.controller';
import { AdminCustomerClubController } from './controllers/admin-customer-club.controller';
import { AdminBlogController } from './controllers/admin-blog.controller';
import { AdminLandingPagesController } from './controllers/admin-landing-pages.controller';
import { AdminBadgesController } from './controllers/admin-badges.controller';
import { AdminVaultController } from './controllers/admin-vault.controller';
import { AdminBackupController } from './controllers/admin-backup.controller';
import { AdminPlatformContentController } from './controllers/admin-platform-content.controller';
import { AdminServerStorageController } from './controllers/admin-server-storage.controller';
import { AdminServerMonitorController } from './controllers/admin-server-monitor.controller';
import { AdminSystemJobsController } from './controllers/admin-system-jobs.controller';
import { AdminCrawlerController } from './controllers/admin-crawler.controller';

// Services
import { AdminDashboardService } from './services/admin-dashboard.service';
import { AdminUsersQueryService } from './services/admin-users-query.service';
import { AdminUserPlanLookupService } from './services/admin-user-plan-lookup.service';
import { AdminListingsQueryService } from './services/admin-listings-query.service';
import { AdminOrdersQueryService } from './services/admin-orders-query.service';
import { AdminOrdersCommandService } from './services/admin-orders-command.service';
import { AdminOrdersNotifyService } from './services/orders-command/admin-orders-notify.service';
import { AdminOrdersStatusService } from './services/orders-command/admin-orders-status.service';
import { AdminOrdersHubService } from './services/orders-command/admin-orders-hub.service';
import { AdminOrdersInspectionService } from './services/orders-command/admin-orders-inspection.service';
import { AdminOrdersEscrowService } from './services/orders-command/admin-orders-escrow.service';
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
import { AdminBlogService } from './services/admin-blog.service';
import { AdminLandingPagesService } from './services/admin-landing-pages.service';
import { SellerLandingBootstrapService } from './services/seller-landing-bootstrap.service';
import { AdminBadgesService } from './services/admin-badges.service';
import { AdminVaultService } from './services/admin-vault.service';
import { AdminListingDeleteService } from './services/admin-listing-delete.service';
import { AdminBackupService } from './services/admin-backup.service';
import { AdminPlatformContentService } from './services/admin-platform-content.service';
import { AdminServerStorageService } from './services/admin-server-storage.service';
import { AdminServerMonitorService } from './services/admin-server-monitor.service';
import { AdminCrawlerService } from './services/admin-crawler.service';
import { AdminBackupScheduler } from './services/admin-backup.scheduler';
import { AdminSystemJobsService } from './services/admin-system-jobs.service';
import { OrdersModule } from '../orders/orders.module';
import { WalletModule } from '../wallet/wallet.module';
import { ListingModule } from '../listing/listing.module';
import { SupportModule } from '../support/support.module';
import { UserRatingHistoryService } from '../users/user-rating-history.service';
import { CommonModuleModule } from '../../common-module/common-module.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    CommonModuleModule,
    NotificationModule,
    FeesModule,
    OrdersModule,
    WalletModule,
    ListingModule,
    SupportModule,
  ],
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
    AdminContactMessagesController,
    AdminCustomerClubController,
    AdminBlogController,
    AdminLandingPagesController,
    AdminBadgesController,
    AdminVaultController,
    AdminBackupController,
    AdminPlatformContentController,
    AdminServerStorageController,
    AdminServerMonitorController,
    AdminSystemJobsController,
    AdminCrawlerController,
  ],
  providers: [
    AdminDashboardService,
    AdminUserPlanLookupService,
    AdminUsersQueryService,
    AdminListingsQueryService,
    AdminOrdersQueryService,
    AdminOrdersNotifyService,
    AdminOrdersStatusService,
    AdminOrdersHubService,
    AdminOrdersInspectionService,
    AdminOrdersEscrowService,
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
    AdminBlogService,
    AdminLandingPagesService,
    SellerLandingBootstrapService,
    AdminBadgesService,
    AdminVaultService,
    AdminListingDeleteService,
    AdminBackupService,
    AdminPlatformContentService,
    AdminServerStorageService,
    AdminServerMonitorService,
    AdminCrawlerService,
    AdminBackupScheduler,
    AdminSystemJobsService,
    SmsService,
    UserRatingHistoryService,
  ],
})
export class AdminModule {}
