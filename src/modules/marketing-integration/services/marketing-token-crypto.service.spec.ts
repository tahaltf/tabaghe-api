import { ConfigService } from '@nestjs/config';
import { MarketingTokenCryptoService } from './marketing-token-crypto.service';

describe('MarketingTokenCryptoService', () => {
  const key =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  function createService(): MarketingTokenCryptoService {
    const config = {
      get: (name: string) =>
        name === 'MARKETING_TOKEN_ENC_KEY' ? key : undefined,
    } as ConfigService;
    const svc = new MarketingTokenCryptoService(config);
    svc.onModuleInit();
    return svc;
  }

  it('encrypts and decrypts access tokens', () => {
    const svc = createService();
    const plain = 'ig-test-access-token-12345';
    const enc = svc.encrypt(plain);
    expect(enc).not.toContain(plain);
    expect(svc.decrypt(enc)).toBe(plain);
  });

  it('reports ready when key is valid', () => {
    const svc = createService();
    expect(svc.isReady()).toBe(true);
  });
});
