import { SetMetadata } from '@nestjs/common';

export const CACHE_CONTROL_KEY = 'httpCacheControl';

/** Sets Cache-Control on successful GET responses (via CacheControlInterceptor). */
export const CacheControl = (value: string) =>
  SetMetadata(CACHE_CONTROL_KEY, value);
