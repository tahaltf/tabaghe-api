import { InstagramWebhookService } from './instagram-webhook.service';
import { createHmac } from 'crypto';

describe('InstagramWebhookService.verifySignature', () => {
  const secrets = {
    get: (key: string) =>
      key === 'META_APP_SECRET' || key === 'META_INSTAGRAM_APP_SECRET'
        ? 'test-secret'
        : undefined,
  };
  const prisma = {} as never;
  const service = new InstagramWebhookService(secrets as never, prisma);

  it('returns false when signature missing', () => {
    expect(service.verifySignature(Buffer.from('{}'), undefined)).toBe(false);
  });

  it('returns false when signature invalid', () => {
    expect(
      service.verifySignature(Buffer.from('{"a":1}'), 'sha256=deadbeef'),
    ).toBe(false);
  });

  it('returns true for valid HMAC', () => {
    const body = Buffer.from('{"object":"instagram"}');
    const sig =
      'sha256=' +
      createHmac('sha256', 'test-secret').update(body).digest('hex');
    expect(service.verifySignature(body, sig)).toBe(true);
  });
});
