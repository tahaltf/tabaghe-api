#!/bin/bash
# رفع 502 — حذف وابستگی دایره‌ای AuthModule → PlansModule
# اجرا روی سرور: bash hotfix-auth-plans-module.sh /app/tabagheh/api

set -e
API_DIR="${1:-/app/tabagheh/api}"
AUTH_DIR="$API_DIR/src/modules/auth"
SERVICES_DIR="$AUTH_DIR/services"

echo "==> API dir: $API_DIR"
mkdir -p "$SERVICES_DIR"

cat > "$SERVICES_DIR/registration-plan.service.ts" << 'EOF'
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { QuotaAction, QuotaReason } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { BUILTIN_FREE_PLAN_ID } from '../../plans/builtin-free-plan-display';

function addDaysUtc(base: Date, days: number): Date {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

@Injectable()
export class RegistrationPlanService {
  private readonly logger = new Logger(RegistrationPlanService.name);

  constructor(private readonly prisma: PrismaService) {}

  async assignDefaultPlan(userId: string): Promise<void> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: 'DEFAULT_REGISTRATION_PLAN_ID' },
    });
    const planId = row?.value?.trim();
    if (!planId || planId === BUILTIN_FREE_PLAN_ID) return;

    const existing = await this.prisma.userPlanPurchase.findFirst({
      where: { userId, status: 'ACTIVE' },
    });
    if (existing) return;

    try {
      await this.grantPlan(userId, planId, 'پلن پیش‌فرض ثبت‌نام');
    } catch (err) {
      this.logger.warn(
        `assignDefaultPlan failed for ${userId}: ${String((err as Error)?.message ?? err)}`,
      );
    }
  }

  private async grantPlan(userId: string, planId: string, note: string) {
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.plan.findUnique({
        where: { id: planId },
        include: { rules: true },
      });
      if (!plan || !plan.isActive) {
        throw new NotFoundException('پلن مورد نظر یافت نشد یا غیرفعال است');
      }

      await tx.userPlanPurchase.updateMany({
        where: { userId, status: 'ACTIVE' },
        data: { status: 'CANCELLED' },
      });

      const durationDays = Math.max(1, plan.durationDays ?? 365);
      const expiresAt = addDaysUtc(new Date(), durationDays);

      const purchase = await tx.userPlanPurchase.create({
        data: {
          userId,
          planId,
          status: 'ACTIVE',
          expiresAt,
        },
      });

      for (const rule of plan.rules) {
        const quotaEntries = Array.from({ length: rule.count }).map(() => ({
          userId,
          planPurchaseId: purchase.id,
          listingType: rule.type,
          action: QuotaAction.RELEASE,
          reason: QuotaReason.PLAN,
          note,
        }));
        if (quotaEntries.length > 0) {
          await tx.quotaLedger.createMany({ data: quotaEntries });
        }
      }

      return purchase;
    });
  }
}
EOF

cat > "$AUTH_DIR/auth.module.ts" << 'EOF'
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { OtpService } from './services/otp.service';
import { TokenService } from './services/token.service';
import { GodadminBootstrapService } from './services/godadmin-bootstrap.service';
import { RegistrationPlanService } from './services/registration-plan.service';
import { NotificationModule } from '../notification/notification.module';
import { SmsService } from '../sms/sms.service';

@Module({
  imports: [
    NotificationModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret:
          config.get<string>('JWT_SECRET') ?? 'fallback_access_secret_key',
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    TokenService,
    JwtStrategy,
    SmsService,
    GodadminBootstrapService,
    RegistrationPlanService,
  ],
  exports: [AuthService, TokenService, OtpService],
})
export class AuthModule {}
EOF

# auth.service.ts — جایگزینی PlansService با RegistrationPlanService
sed -i "s|import { PlansService } from '../plans/plans.service';|import { RegistrationPlanService } from './services/registration-plan.service';|g" "$AUTH_DIR/auth.service.ts"
sed -i 's|private readonly plansService: PlansService|private readonly registrationPlan: RegistrationPlanService|g' "$AUTH_DIR/auth.service.ts"
sed -i 's|void this.plansService.assignRegistrationDefaultPlan(user.id)|void this.registrationPlan.assignDefaultPlan(user.id)|g' "$AUTH_DIR/auth.service.ts"
sed -i '/PlansModule/d' "$AUTH_DIR/auth.module.ts" 2>/dev/null || true

echo "==> Verify (PlansModule باید خالی باشد):"
grep PlansModule "$AUTH_DIR/auth.module.ts" && echo "ERROR: هنوز PlansModule هست!" && exit 1 || echo "OK: PlansModule حذف شد"
test -f "$SERVICES_DIR/registration-plan.service.ts" && echo "OK: registration-plan.service.ts"

echo ""
echo "==> حالا build کنید:"
echo "  cd $API_DIR && docker build -t tabagheh-backend:latest --no-cache ."
echo "  cd /app/tabagheh && docker compose up -d backend"
echo "  curl -s http://127.0.0.1:3000/health"
