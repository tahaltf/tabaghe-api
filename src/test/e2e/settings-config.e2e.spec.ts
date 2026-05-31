import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AdminSettingsService } from '../../modules/admin/services/admin-settings.service';

describe('Settings config E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let settings: AdminSettingsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    settings = app.get(AdminSettingsService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('reads auction hours with legacy minutes fallback', async () => {
    await prisma.systemSetting.upsert({
      where: { key: 'AUCTION_PAYMENT_DEADLINE_MINUTES' },
      update: { value: '120' },
      create: { key: 'AUCTION_PAYMENT_DEADLINE_MINUTES', value: '120' },
    });
    await prisma.systemSetting.deleteMany({
      where: { key: 'AUCTION_WINNER_PAYMENT_DEADLINE_HOURS' },
    });

    const cfg = await settings.getSiteConfig();
    expect(Number(cfg.AUCTION_WINNER_PAYMENT_DEADLINE_HOURS)).toBe(2);
  });

  it('persists EXCHANGE_PAYMENT_TRUST_PENALTY', async () => {
    await settings.upsert({
      key: 'EXCHANGE_PAYMENT_TRUST_PENALTY',
      value: '12',
    });
    const row = await prisma.systemSetting.findUnique({
      where: { key: 'EXCHANGE_PAYMENT_TRUST_PENALTY' },
    });
    expect(row?.value).toBe('12');
  });
});
