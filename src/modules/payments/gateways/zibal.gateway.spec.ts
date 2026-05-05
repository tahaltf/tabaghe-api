import axios from 'axios';
import { BadGatewayException } from '@nestjs/common';
import { ZibalGateway } from './zibal.gateway';

jest.mock('axios');

describe('ZibalGateway', () => {
  const appSettingsMock = {
    getPaymentGatewayConfig: jest.fn().mockReturnValue({
      merchant: 'zibal',
      requestUrl: 'https://gateway.zibal.ir/v1/request',
      verifyUrl: 'https://gateway.zibal.ir/v1/verify',
    }),
    buildZibalStartPayUrl: jest.fn((trackId: string) => `https://gateway.zibal.ir/start/${trackId}`),
  };

  const gateway = new ZibalGateway(appSettingsMock as any);
  const mockedAxios = axios as jest.Mocked<typeof axios>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends amount to zibal in rial (toman * 10)', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { result: 100, trackId: '12345', message: 'ok' },
    } as any);

    await gateway.requestPayment({
      amount: 50000,
      callbackUrl: 'http://callback',
      orderId: 'o-1',
      description: 'test',
      mobile: '09120000000',
    });

    const payload = mockedAxios.post.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.amount).toBe(500000);
  });

  it('verifies amount in rial against expected toman*10', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { result: 100, amount: 250000, refNumber: 'ref-1', message: 'ok' },
    } as any);

    const result = await gateway.verifyPayment({
      authority: '123',
      expectedAmount: 25000,
    });

    expect(result.success).toBe(true);
  });

  it('verifies when gateway returns amount as numeric string (rial)', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { result: 100, amount: '250000', refNumber: 'ref-1', message: 'ok' },
    } as any);

    const result = await gateway.verifyPayment({
      authority: '123',
      expectedAmount: 25000,
    });

    expect(result.success).toBe(true);
  });

  it('throws when request does not return valid authority', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { result: 400, message: 'invalid' },
    } as any);

    await expect(
      gateway.requestPayment({
        amount: 10000,
        callbackUrl: 'http://callback',
        orderId: 'o-2',
        description: 'test',
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
