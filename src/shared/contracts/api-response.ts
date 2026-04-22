/**
 * قرارداد یکپارچه‌ی پاسخ API
 * تمام endpoint های HTTP این envelope را برمی‌گردانند (مگر با @RawResponse()).
 * فرانت باید دقیقاً همین ساختار را mirror کند.
 */

export interface ApiErrorDetails {
  /** شناسه‌ی خطای قابل‌خواندن توسط ماشین (مثلاً VALIDATION_ERROR، NOT_FOUND) */
  code: string;
  /** پیام اصلی قابل‌نمایش به کاربر */
  message: string;
  /** خطاهای فیلدی (در ولیدیشن) */
  fieldErrors?: Record<string, string[]>;
  /** فقط در حالت non-production: اطلاعات دیباگ */
  debug?: string;
}

export interface ApiMeta {
  timestamp: string;
  path?: string;
  /** برای پاسخ‌های لیستی */
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  [key: string]: unknown;
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta: ApiMeta;
  error: null;
}

export interface ApiErrorResponse {
  success: false;
  data: null;
  meta: ApiMeta;
  error: ApiErrorDetails;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * کمک‌کننده برای ساخت envelope موفق.
 * بیشتر توسط ResponseEnvelopeInterceptor استفاده می‌شود.
 */
export function buildSuccessEnvelope<T>(
  data: T,
  meta: Partial<ApiMeta> = {},
): ApiSuccessResponse<T> {
  return {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      ...meta,
    },
    error: null,
  };
}

/**
 * کمک‌کننده برای ساخت envelope خطا.
 */
export function buildErrorEnvelope(
  error: ApiErrorDetails,
  meta: Partial<ApiMeta> = {},
): ApiErrorResponse {
  return {
    success: false,
    data: null,
    meta: {
      timestamp: new Date().toISOString(),
      ...meta,
    },
    error,
  };
}
