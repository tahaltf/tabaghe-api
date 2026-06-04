/**
 * آیا کاربر در تنظیمات پنل، دریافت پیامک اطلاع‌رسانی را فعال کرده است؟
 * OTP ورود از این قاعده مستثنا است (مسیر جدا در OtpService).
 */
export function isUserOperationalSmsEnabled(
  notifySms: boolean | null | undefined,
): boolean {
  return notifySms === true;
}
