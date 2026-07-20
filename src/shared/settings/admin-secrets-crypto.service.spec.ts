import { ConfigService } from '@nestjs/config';
import { AdminSecretsCryptoService } from './admin-secrets-crypto.service';

describe('AdminSecretsCryptoService', () => {
  const key =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  function createService(): AdminSecretsCryptoService {
    const config = {
      get: (name: string) =>
        name === 'ADMIN_SECRETS_ENC_KEY' ? key : undefined,
    } as ConfigService;
    const svc = new AdminSecretsCryptoService(config);
    svc.onModuleInit();
    return svc;
  }

  it('encrypts and decrypts server secrets', () => {
    const svc = createService();
    const plain = 'server-secret-value-123';
    const enc = svc.encrypt(plain);
    expect(enc).not.toContain(plain);
    expect(svc.decrypt(enc)).toBe(plain);
  });

  it('reports ready when key is valid', () => {
    const svc = createService();
    expect(svc.isReady()).toBe(true);
  });
});
