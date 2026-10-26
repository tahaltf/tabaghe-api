import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';
import { FeesModule } from '../fees/fees.module';

// Controllers
import { AdminDashboardController } from './controllers/admin-dashboard.controller';
import { AdminUsersQueryController } from './controllers/admin-users.controller';
import { AdminInquiryRestrictionsController } from './controllers/admin-inquiry-restrictions.controller';
import { AdminListingsQueryController } from './controllers/admin-listings.controller';
import { AdminListingMergeController } from './controllers/admin-listing-merge.controller';
import { AdminOrdersQueryController } from './controllers/admin-orders.controller';
import { AdminTransactionsController } from './controllers/admin-transactions.controller';
import { AdminCategoriesController } from './controllers/admin-categories.controller';
import { AdminLocationsController } from './controllers/admin-locations.controller';
import { AdminSettingsController } from './controllers/admin-settings.controller';
import { AdminPlansController } from './controllers/admin-plans.controller';
import { AdminFeeRulesController } from './controllers/admin-fee-rules.controller';
import { AdminVerificationFeeRulesController } from './controllers/admin-verification-fee-rules.controller';
import { AdminGiteaIpAllowlistController } from './controllers/admin-gitea-ip-allowlist.controller';
import { AdminCrawlerIpAllowlistController } from './controllers/admin-crawler-ip-allowlist.controller';
import { CrawlerPanelAuthController } from './controllers/crawler-panel-auth.controller';
import { AdminRepairsController } from './controllers/admin-repairs.controller';
import { AdminProductRequestsController } from './controllers/admin-product-requests.controller';
import { AdminTicketsController } from './controllers/admin-tickets.controller';
import { AdminNotificationsController } from './controllers/admin-notifications.controller';
import { AdminDisputesController } from './controllers/admin-disputes.controller';
import { AdminFaqController } from './controllers/admin-faq.controller';
import { AdminSmsController } from './controllers/admin-sms.controller';
import { AdminSmsIrController } from './controllers/admin-smsir.controller';
import { AdminLogsController } from './controllers/admin-logs.controller';
import { AdminPlatformWalletController } from './controllers/admin-platform-wallet.controller';
import { AdminContactMessagesController } from './controllers/admin-contact-messages.controller';
import { AdminCustomerClubController } from './controllers/admin-customer-club.controller';
import { AdminSellerCrmController } from './controllers/admin-seller-crm.controller';
import { SellerCrmIngestController } from './controllers/seller-crm-ingest.controller';
import { SellerCrmIngestGuard } from './guards/seller-crm-ingest.guard';
import { AdminBlogController } from './controllers/admin-blog.controller';
import { AdminLandingPagesController } from './controllers/admin-landing-pages.controller';
import { AdminBadgesController } from './controllers/admin-badges.controller';
import { AdminVaultController } from './controllers/admin-vault.controller';
import { AdminBackupController } from './controllers/admin-backup.controller';
import { AdminPlatformContentController } from './controllers/admin-platform-content.controller';
import { AdminServerStorageController } from './controllers/admin-server-storage.controller';
import { AdminServerMonitorController } from './controllers/admin-server-monitor.controller';
import { AdminSystemJobsController } from './controllers/admin-system-jobs.controller';
import { AdminRolesController } from './controllers/admin-roles.controller';

// Services
import { AdminDashboardService } from './services/admin-dashboard.service';
import { AdminUsersQueryService } from './services/admin-users-query.service';
import { AdminUserCategoryFeesService } from './services/admin-user-category-fees.service';
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
import { AdminSecretKeysService } from './services/admin-secret-keys.service';
import { AdminPlansService } from './services/admin-plans.service';
import { AdminFeeRulesService } from './services/admin-fee-rules.service';
import { AdminVerificationFeeRulesService } from './services/admin-verification-fee-rules.service';
import { AdminGiteaIpAllowlistService } from './services/admin-gitea-ip-allowlist.service';
import { AdminCrawlerIpAllowlistService } from './services/admin-crawler-ip-allowlist.service';
import { AdminCrawlerPanelUsersService } from './services/admin-crawler-panel-users.service';
import { AdminRepairsService } from './services/admin-repairs.service';
import { AdminProductRequestsService } from './services/admin-product-requests.service';
import { AdminTicketsService } from './services/admin-tickets.service';
import { AdminDisputesService } from './services/admin-disputes.service';
import { AdminFaqService } from './services/admin-faq.service';
import { AdminSmsService } from './services/admin-sms.service';
import { AdminSmsIrService } from './services/admin-smsir.service';
import { AdminLogsService } from './services/admin-logs.service';
import { AdminPlatformWalletService } from './services/admin-platform-wallet.service';
import { SmsModule } from '../sms/sms.module';
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
import { AdminBackupScheduler } from './services/admin-backup.scheduler';
import { AdminSystemJobsService } from './services/admin-system-jobs.service';
import { AdminRolesService } from './services/admin-roles.service';
import { AdminRbacBootstrapService } from './services/admin-rbac-bootstrap.service';
import { AdminSellerCrmService } from './services/admin-seller-crm.service';
import { OrdersModule } from '../orders/orders.module';
import { WalletModule } from '../wallet/wallet.module';
import { ListingModule } from '../listing/listing.module';
import { SupportModule } from '../support/support.module';
import { PlansModule } from '../plans/plans.module';
import { UserRatingHistoryService } from '../users/user-rating-history.service';
import { CommonModuleModule } from '../../common-module/common-module.module';
import { ReferralModule } from '../referral/referral.module';
import { UsersModule } from '../users/users.module';
import { ZohalModule } from '../zohal/zohal.module';
import { CurrencyModule } from '../currency/currency.module';
import { AdminCurrenciesController } from './controllers/admin-currencies.controller';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    CommonModuleModule,
    NotificationModule,
    SmsModule,
    FeesModule,
    OrdersModule,
    WalletModule,
    ListingModule,
    SupportModule,
    PlansModule,
    ReferralModule,
    UsersModule,
    ZohalModule,
    CurrencyModule,
  ],
  controllers: [
    AdminDashboardController,
    AdminUsersQueryController,
    AdminInquiryRestrictionsController,
    AdminListingsQueryController,
    AdminListingMergeController,
    AdminOrdersQueryController,
    AdminTransactionsController,
    AdminCategoriesController,
    AdminLocationsController,
    AdminSettingsController,
    AdminCurrenciesController,
    AdminPlansController,
    AdminFeeRulesController,
    AdminVerificationFeeRulesController,
    AdminGiteaIpAllowlistController,
    AdminCrawlerIpAllowlistController,
    CrawlerPanelAuthController,
    AdminRepairsController,
    AdminProductRequestsController,
    AdminTicketsController,
    AdminNotificationsController,
    AdminDisputesController,
    AdminFaqController,
    AdminSmsController,
    AdminSmsIrController,
    AdminLogsController,
    AdminPlatformWalletController,
    AdminContactMessagesController,
    AdminCustomerClubController,
    AdminSellerCrmController,
    SellerCrmIngestController,
    AdminBlogController,
    AdminLandingPagesController,
    AdminBadgesController,
    AdminVaultController,
    AdminBackupController,
    AdminPlatformContentController,
    AdminServerStorageController,
    AdminServerMonitorController,
    AdminSystemJobsController,
    AdminRolesController,
  ],
  providers: [
    AdminDashboardService,
    AdminUserPlanLookupService,
    AdminUsersQueryService,
    AdminUserCategoryFeesService,
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
    AdminSecretKeysService,
    AdminPlansService,
    AdminFeeRulesService,
    AdminVerificationFeeRulesService,
    AdminGiteaIpAllowlistService,
    AdminCrawlerIpAllowlistService,
    AdminCrawlerPanelUsersService,
    AdminRepairsService,
    AdminProductRequestsService,
    AdminTicketsService,
    AdminDisputesService,
    AdminFaqService,
    AdminSmsService,
    AdminSmsIrService,
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
    AdminBackupScheduler,
    AdminSystemJobsService,
    UserRatingHistoryService,
    AdminRolesService,
    AdminRbacBootstrapService,
    AdminSellerCrmService,
    SellerCrmIngestGuard,
  ],
})
export class AdminModule {}
