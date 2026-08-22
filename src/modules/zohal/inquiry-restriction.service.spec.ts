import { HttpStatus } from '@nestjs/common';
import { InquiryRestrictionService } from './inquiry-restriction.service';

describe('InquiryRestrictionService', () => {
  const userId = 'user-1';
  const minuteAgo = new Date(Date.now() - 60_000);
  const dayAgo = new Date(Date.now() - 86_400_000);

  const prismaMock = {
    userInquiryRestriction: {
      upsert: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    userBankAccount: {
      count: jest.fn(),
    },
    zohalInquiryLog: {
      count: jest.fn(),
    },
    systemSetting: {
      findMany: jest.fn(),
    },
  };

  const service = new InquiryRestrictionService(prismaMock as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.userInquiryRestriction.upsert.mockResolvedValue({
      userId,
      inquiryBlocked: false,
      manualEntryOnly: false,
      identityPayloadAttempts: 0,
      identityFailureCount: 0,
      financialPayloadAttempts: 0,
      financialFailureCount: 0,
      maxInquiriesPerMinute: null,
      maxInquiriesPerDay: null,
      maxBankAccounts: null,
    });
    prismaMock.userBankAccount.count.mockResolvedValue(0);
    prismaMock.systemSetting.findMany.mockResolvedValue([]);
    prismaMock.zohalInquiryLog.count.mockImplementation(({ where }: { where: { createdAt?: { gte: Date } } }) => {
      const since = where.createdAt?.gte?.getTime() ?? 0;
      if (since >= minuteAgo.getTime()) return Promise.resolve(5);
      if (since >= dayAgo.getTime()) return Promise.resolve(10);
      return Promise.resolve(0);
    });
  });

  it('throws 429 when minute usage reaches limit', async () => {
    await expect(service.assertRateLimit(userId)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });

  it('uses per-user override limits when set', async () => {
    prismaMock.userInquiryRestriction.upsert.mockResolvedValue({
      userId,
      inquiryBlocked: false,
      manualEntryOnly: false,
      identityPayloadAttempts: 0,
      identityFailureCount: 0,
      financialPayloadAttempts: 0,
      financialFailureCount: 0,
      maxInquiriesPerMinute: 10,
      maxInquiriesPerDay: 100,
    });
    prismaMock.zohalInquiryLog.count.mockResolvedValue(5);

    await expect(service.assertRateLimit(userId)).resolves.toBeUndefined();
  });

  it('blocks inquiry when inquiryBlocked flag is set', async () => {
    prismaMock.userInquiryRestriction.upsert.mockResolvedValue({
      userId,
      inquiryBlocked: true,
      manualEntryOnly: false,
      blockedReason: 'test',
      identityPayloadAttempts: 0,
      identityFailureCount: 0,
      financialPayloadAttempts: 0,
      financialFailureCount: 0,
      maxInquiriesPerMinute: null,
      maxInquiriesPerDay: null,
    });

    await expect(service.assertCanInquire(userId, 'identity')).rejects.toThrow('test');
  });

  it('returns snapshot with usage and limits', async () => {
    const snapshot = await service.getSnapshot(userId);
    expect(snapshot.limits.minute).toBe(5);
    expect(snapshot.limits.day).toBe(30);
    expect(snapshot.usage.minute).toBe(5);
    expect(snapshot.usage.day).toBe(10);
    expect(snapshot.bankAccounts).toEqual({ activeCount: 0, limit: 3 });
  });
});
