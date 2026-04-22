import { SetMetadata } from '@nestjs/common';

/**
 * علامت‌گذاری endpoint هایی که نباید در envelope پیچیده شوند
 * (مثلاً stream فایل، redirect، health check خام).
 *
 * استفاده:
 *   @RawResponse()
 *   @Get('download')
 *   async download() { return fileStream; }
 */
export const RAW_RESPONSE_KEY = 'rawResponse';
export const RawResponse = (): MethodDecorator & ClassDecorator =>
  SetMetadata(RAW_RESPONSE_KEY, true);
