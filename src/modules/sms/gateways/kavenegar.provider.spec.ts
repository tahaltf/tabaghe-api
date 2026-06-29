import axios from 'axios';
import { InternalServerErrorException } from '@nestjs/common';
import {
  KavenegarProvider,
} from './kavenegar.provider';

jest.mock('axios');

describe('KavenegarProvider', () => {
  const appSettingsMock = {
    getKavenegarApiKey: jest.fn().mockReturnValue('test-api-key'),
  };

  const provider = new KavenegarProvider(appSettingsMock as any);
  const mockedAxios = axios as jest.Mocked<typeof axios>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends lookup request and returns on success', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        return: { status: 200, message: 'تایید شد' },
        entries: [{ messageid: 1 }],
      },
    } as any);

    const result = await provider.sendByTemplate(
      '09121234567',
      { templateName: 'myverification' },
      [{ name: 'token', value: '123456' }],
    );

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://api.kavenegar.com/v1/test-api-key/verify/lookup.json',
      {
        params: {
          receptor: '09121234567',
          template: 'myverification',
          token: '123456',
        },
      },
    );
    expect(result).toEqual({
      return: { status: 200, message: 'تایید شد' },
      entries: [{ messageid: 1 }],
    });
  });

  it('maps named token slots directly', () => {
    const tokens = KavenegarProvider.mapParametersToTokens([
      { name: 'token2', value: 'B' },
      { name: 'token', value: 'A' },
    ]);

    expect(tokens).toEqual({ token2: 'B', token: 'A' });
  });

  it('maps arbitrary parameter names to token slots in order', () => {
    const tokens = KavenegarProvider.mapParametersToTokens([
      { name: 'NAME', value: 'Ali' },
      { name: 'AMOUNT', value: '1000' },
    ]);

    expect(tokens).toEqual({ token: 'Ali', token2: '1000' });
  });

  it('throws when template name is missing', async () => {
    await expect(
      provider.sendByTemplate('09121234567', {}, [{ name: 'token', value: '1' }]),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('throws when kavenegar returns non-200 status', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        return: { status: 424, message: 'الگوی مورد نظر پیدا نشد' },
      },
    } as any);

    await expect(
      provider.sendByTemplate(
        '09121234567',
        { templateName: 'missing-template' },
        [{ name: 'token', value: '123456' }],
      ),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
