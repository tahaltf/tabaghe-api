import { PrismaClient } from '@prisma/client';

const CURRENCIES = [
  {
    code: 'IRT',
    nameFa: 'تومان',
    symbol: 'تومان',
    isEnabled: true,
    sortOrder: 0,
    decimals: 0,
    navasanItem: null as string | null,
    rateToToman: 1,
    source: 'manual',
  },
  {
    code: 'USD',
    nameFa: 'دلار آمریکا',
    symbol: '$',
    isEnabled: false,
    sortOrder: 10,
    decimals: 2,
    navasanItem: 'usd',
    rateToToman: 0,
    source: 'navasan',
  },
  {
    code: 'AED',
    nameFa: 'درهم امارات',
    symbol: 'د.إ',
    isEnabled: false,
    sortOrder: 20,
    decimals: 2,
    navasanItem: 'aed',
    rateToToman: 0,
    source: 'navasan',
  },
  {
    code: 'TRY',
    nameFa: 'لیر ترکیه',
    symbol: '₺',
    isEnabled: false,
    sortOrder: 30,
    decimals: 2,
    navasanItem: 'try',
    rateToToman: 0,
    source: 'navasan',
  },
  {
    code: 'IQD',
    nameFa: 'دینار عراق',
    symbol: 'د.ع',
    isEnabled: false,
    sortOrder: 40,
    decimals: 0,
    navasanItem: 'iqd',
    rateToToman: 0,
    source: 'navasan',
  },
] as const;

export async function seedCurrencies(prisma: PrismaClient): Promise<void> {
  for (const c of CURRENCIES) {
    await prisma.currency.upsert({
      where: { code: c.code },
      create: {
        code: c.code,
        nameFa: c.nameFa,
        symbol: c.symbol,
        isEnabled: c.isEnabled,
        sortOrder: c.sortOrder,
        decimals: c.decimals,
        navasanItem: c.navasanItem,
        rate: {
          create: {
            rateToToman: c.rateToToman,
            source: c.source,
            fetchedAt: c.code === 'IRT' ? new Date() : null,
          },
        },
      },
      update: {
        nameFa: c.nameFa,
        symbol: c.symbol,
        sortOrder: c.sortOrder,
        decimals: c.decimals,
        navasanItem: c.navasanItem,
      },
    });
  }
  console.log(`✅ ${CURRENCIES.length} ارز seed شد`);
}
