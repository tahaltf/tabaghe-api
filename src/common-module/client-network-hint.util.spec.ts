import type { Request } from 'express';
import { buildClientNetworkHint } from './client-network-hint.util';

describe('buildClientNetworkHint', () => {
  const req = (init: {
    headers?: Record<string, string>;
    ip?: string;
    remoteAddress?: string;
  }) =>
    ({
      headers: init.headers ?? {},
      ip: init.ip,
      socket: init.remoteAddress ? { remoteAddress: init.remoteAddress } : undefined,
    }) as Request;

  it('IR از cf-ipcountry نباید هشدار بدهد', () => {
    const r = buildClientNetworkHint(req({ headers: { 'cf-ipcountry': 'IR' } }));
    expect(r.countryCode).toBe('IR');
    expect(r.suggestNonIranConnection).toBe(false);
    expect(r.detectionSource).toBe('cf-ipcountry');
  });

  it('DE باید هشدار بدهد', () => {
    const r = buildClientNetworkHint(req({ headers: { 'cf-ipcountry': 'DE' } }));
    expect(r.countryCode).toBe('DE');
    expect(r.suggestNonIranConnection).toBe(true);
  });

  it('XX باید ناشناخته باشد', () => {
    const r = buildClientNetworkHint(req({ headers: { 'cf-ipcountry': 'XX' } }));
    expect(r.countryCode).toBeNull();
    expect(r.suggestNonIranConnection).toBe(false);
  });

  it('بدون هدر و IP محلی نباید هشدار بدهد', () => {
    const r = buildClientNetworkHint(
      req({ ip: '127.0.0.1', remoteAddress: '127.0.0.1' }),
    );
    expect(r.countryCode).toBeNull();
    expect(r.suggestNonIranConnection).toBe(false);
  });

  it('بدون هدر، IP خارجی باید با geoip-lite هشدار بدهد', () => {
    const r = buildClientNetworkHint(
      req({ ip: '8.8.8.8', remoteAddress: '8.8.8.8' }),
    );
    expect(r.countryCode).toBe('US');
    expect(r.suggestNonIranConnection).toBe(true);
    expect(r.detectionSource).toBe('geoip-lite');
  });

  it('x-tabaghe-client-country اولویت بعد از cf و vercel', () => {
    const r = buildClientNetworkHint(
      req({ headers: { 'x-tabaghe-client-country': 'FR' } }),
    );
    expect(r.countryCode).toBe('FR');
    expect(r.suggestNonIranConnection).toBe(true);
    expect(r.detectionSource).toBe('x-tabaghe-client-country');
  });

  it('در صورت وجود cf-ipcountry، هدر سفارشی نادیده گرفته می‌شود', () => {
    const r = buildClientNetworkHint(
      req({
        headers: {
          'cf-ipcountry': 'IR',
          'x-tabaghe-client-country': 'US',
        },
      }),
    );
    expect(r.countryCode).toBe('IR');
    expect(r.suggestNonIranConnection).toBe(false);
  });
});
