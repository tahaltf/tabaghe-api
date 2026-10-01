import { WordPressConnectionService } from './connection.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

describe('WordPressConnectionService ping policy', () => {
  it('returns syncIntervalHours and minStockForAvailable from connection row', async () => {
    const prisma = {
      wordPressConnection: {
        upsert: jest.fn().mockResolvedValue({
          syncIntervalHours: 6,
          minStockForAvailable: 2,
        }),
      },
    };
    const service = new WordPressConnectionService(prisma as unknown as PrismaService);
    const result = await service.ping('user-1', {
      siteUrl: 'https://shop.example/',
      pluginVersion: '1.0.0',
    });
    expect(result).toEqual({
      ok: true,
      syncIntervalHours: 6,
      minStockForAvailable: 2,
    });
  });
});
