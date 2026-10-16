import { assertSafeEgressUrl } from './safe-egress-url.util';

describe('assertSafeEgressUrl', () => {
  const prev = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = prev;
  });

  it('rejects http in production', async () => {
    process.env.NODE_ENV = 'production';
    await expect(
      assertSafeEgressUrl('http://example.com/a.jpg'),
    ).rejects.toThrow(/https/i);
  });

  it('rejects metadata / link-local IPs', async () => {
    process.env.NODE_ENV = 'production';
    await expect(
      assertSafeEgressUrl('https://169.254.169.254/latest/meta-data/'),
    ).rejects.toThrow();
  });

  it('rejects localhost hostname', async () => {
    process.env.NODE_ENV = 'production';
    await expect(
      assertSafeEgressUrl('https://localhost/secret'),
    ).rejects.toThrow();
  });

  it('rejects private IPv4 literals', async () => {
    process.env.NODE_ENV = 'production';
    await expect(
      assertSafeEgressUrl('https://192.168.1.1/x'),
    ).rejects.toThrow();
    await expect(assertSafeEgressUrl('https://10.0.0.5/x')).rejects.toThrow();
  });
});
