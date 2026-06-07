import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {
  GODADMIN_PHONE,
  TEST_ADMIN_PASSWORD,
  TEST_USER_SEEDS,
} from '../src/shared/test-users';

const prisma = new PrismaClient();

async function upsertVerifiedUser(seed: (typeof TEST_USER_SEEDS)[number]) {
  const passwordHash =
    seed.role === UserRole.ADMIN
      ? await bcrypt.hash(TEST_ADMIN_PASSWORD, 10)
      : undefined;

  const user = await prisma.user.upsert({
    where: { phone: seed.phone },
    create: {
      phone: seed.phone,
      role: seed.role,
      firstName: seed.firstName,
      lastName: seed.lastName,
      nationalCode: seed.nationalCode,
      shabaNumber: seed.shabaNumber,
      status: UserStatus.APPROVED,
      isVerified: true,
      isActive: true,
      trustScore: 100,
      termsAcceptedAt: new Date(),
      passwordHash,
    },
    update: {
      role: seed.role,
      firstName: seed.firstName,
      lastName: seed.lastName,
      nationalCode: seed.nationalCode,
      shabaNumber: seed.shabaNumber,
      status: UserStatus.APPROVED,
      isVerified: true,
      isActive: true,
      trustScore: 100,
      termsAcceptedAt: new Date(),
      ...(passwordHash ? { passwordHash } : {}),
    },
  });

  await prisma.wallet.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      balanceAvailable: 0,
      balanceBlocked: 0,
    },
    update: {},
  });

  return user;
}

async function ensureGodadmin() {
  const passwordHash = await bcrypt.hash(TEST_ADMIN_PASSWORD, 10);
  const user = await prisma.user.upsert({
    where: { phone: GODADMIN_PHONE },
    create: {
      phone: GODADMIN_PHONE,
      role: UserRole.GODADMIN,
      isActive: true,
      passwordHash,
    },
    update: {
      role: UserRole.GODADMIN,
      isActive: true,
      passwordHash,
    },
  });

  await prisma.wallet.upsert({
    where: { userId: user.id },
    create: { userId: user.id },
    update: {},
  });

  return user;
}

async function main() {
  console.log('🧪 ساخت/به‌روزرسانی کاربران تست طبقه...\n');

  const godadmin = await ensureGodadmin();
  console.log(`✅ GODADMIN  ${godadmin.phone}  (id: ${godadmin.id})`);

  for (const seed of TEST_USER_SEEDS) {
    const user = await upsertVerifiedUser(seed);
    const roleLabel =
      seed.label === 'seller'
        ? 'فروشنده'
        : seed.label === 'buyer'
          ? 'خریدار'
          : 'ادمین';
    console.log(`✅ ${roleLabel.padEnd(8)}  ${user.phone}  (id: ${user.id})`);
  }

  console.log('\n📋 خلاصه ورود:');
  console.log('   کاربران عادی (خریدار/فروشنده): /auth  →  OTP: 11111');
  console.log('   ادمین تست:                    /admin-auth  →  رمز: @Ab123456789@  →  OTP: 11111');
  console.log(`   GODADMIN:                     /admin-auth  →  ${GODADMIN_PHONE}  →  همان رمز و OTP\n`);
}

main()
  .catch((error) => {
    console.error('❌ seed-test-users failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
