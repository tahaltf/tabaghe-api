import { buildClientNetworkHint } from './client-network-hint.util';

describe('buildClientNetworkHint', () => {
  const req = (headers: Record<string, string>) =>
    ({ headers } as Parameters<typeof buildClientNetworkHint>[0]);

  it('IR از cf-ipcountry نباید هشدار بدهد', () => {
    const r = buildClientNetworkHint(req({ 'cf-ipcountry': 'IR' }));
    expect(r.countryCode).toBe('IR');
    expect(r.suggestNonIranConnection).toBe(false);
    expect(r.detectionSource).toBe('cf-ipcountry');
  });

  it('DE باید هشدار بدهد', () => {
    const r = buildClientNetworkHint(req({ 'cf-ipcountry': 'DE' }));
    expect(r.countryCode).toBe('DE');
    expect(r.suggestNonIranConnection).toBe(true);
  });

  it('XX باید ناشناخته باشد', () => {
    const r = buildClientNetworkHint(req({ 'cf-ipcountry': 'XX' }));
    expect(r.countryCode).toBeNull();
    expect(r.suggestNonIranConnection).toBe(false);
  });

  it('بدون هدر نباید هشدار بدهد', () => {
    const r = buildClientNetworkHint(req({}));
    expect(r.countryCode).toBeNull();
    expect(r.suggestNonIranConnection).toBe(false);
  });

  it('x-tabaghe-client-country اولویت بعد از cf و vercel', () => {
    const r = buildClientNetworkHint(
      req({ 'x-tabaghe-client-country': 'FR' }),
    );
    expect(r.countryCode).toBe('FR');
    expect(r.suggestNonIranConnection).toBe(true);
    expect(r.detectionSource).toBe('x-tabaghe-client-country');
  });

  it('در صورت وجود cf-ipcountry، هدر سفارشی نادیده گرفته می‌شود', () => {
    const r = buildClientNetworkHint(
      req({
        'cf-ipcountry': 'IR',
        'x-tabaghe-client-country': 'US',
      }),
    );
    expect(r.countryCode).toBe('IR');
    expect(r.suggestNonIranConnection).toBe(false);
  });
});
