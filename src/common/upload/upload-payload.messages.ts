import { ORDER_SHIPPING_VIDEO_MAX_LABEL } from './order-shipping-video-upload.config';

/** پیام خطای ۴۱۳ برای ویدیوی ارسال/بسته‌بندی سفارش */
export const ORDER_SHIPPING_VIDEO_TOO_LARGE_MESSAGE = `حجم ویدیوی ارسالی بیش از حد مجاز است. حداکثر ${ORDER_SHIPPING_VIDEO_MAX_LABEL} برای ویدیوی بسته‌بندی/ارسال قابل قبول است؛ لطفاً ویدیو را فشرده کنید یا کیفیت را کاهش دهید و دوباره تلاش کنید.`;

/** پیام عمومی ۴۱۳ برای سایر آپلودها */
export const GENERIC_PAYLOAD_TOO_LARGE_MESSAGE =
  'حجم فایل ارسالی بیش از حد مجاز است. سقف‌های رایج: تصویر آگهی ۱۰ مگابایت؛ کارت ملی و رسید واریز ۵ مگابایت؛ بنر ۸ مگابایت؛ لوگو ۲ مگابایت؛ ویدیوی سفارش تا ۵۰ مگابایت. لطفاً فایل کوچک‌تر انتخاب کنید یا کیفیت را کاهش دهید.';

export function payloadTooLargeMessageForPath(path: string): string {
  if (/\/shipping|return-shipping|return-tracking/i.test(path)) {
    return ORDER_SHIPPING_VIDEO_TOO_LARGE_MESSAGE;
  }
  return GENERIC_PAYLOAD_TOO_LARGE_MESSAGE;
}
