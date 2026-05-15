
# قبل از اجرا حتماً NODE_ENV=production را در محیط پروسه ست کن (Docker، PM2، systemd)
# چون بارگذاری env بر اساس NODE_ENV است؛ بدون آن ممکن است پیش‌فرض development خوانده شود.

API_URL=https://api.tabagheh.com
FRONTEND_APP_URL=https://tabagheh.com
PAYMENT_RETURN_URL=https://tabagheh.com/payment-result
FRONTEND_ORIGINS=https://tabagheh.com,https://www.tabagheh.com

ACTIVE_PAYMENT_GATEWAY=zibal
ZIBAL_MERCHANT=699eee4d52f8370028c7a35f
ZIBAL_REQUEST_URL=https://gateway.zibal.ir/v1/request
ZIBAL_VERIFY_URL=https://gateway.zibal.ir/v1/verify
ZIBAL_START_PAY_URL=https://gateway.zibal.ir/start
ZIBAL_CALLBACK_URL=https://api.tabagheh.com/api/v1/payments/callback/zibal
# اگر سرور ENOTFOUND برای gateway.zibal.ir می‌دهد: روی همان سرور DNS را چک کنید
# (nslookup gateway.zibal.ir، یا DNS عمومی مثل 8.8.8.8 در resolv.conf / Docker --dns).
# خروجی HTTPS به این دامنه باید از خود سرور API باز باشد.

DATABASE_URL="postgresql://tabagheh_superadmin:@QWEasd123456@172.17.0.1:5432/tabagheh_maindb"

JWT_SECRET="MySuperSecretKey123!@#"
JWT_REFRESH_SECRET="MySuperRefreshSecretKey456!@#"
SMS_IR_API_KEY="KKga0Nfx71xw9UYt97Fw0YyO9heRGugsDMsBfSStX7dqczNS"
NODE_ENV=production
WEB_PUSH_VAPID_PUBLIC_KEY=
WEB_PUSH_VAPID_PRIVATE_KEY=
WEB_PUSH_VAPID_SUBJECT=mailto:support@tabagheh.com

PORT=3000



