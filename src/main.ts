import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // ۱. امنیت: جلوگیری از حملات رایج وب با تنظیم هدرهای HTTP
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // برای لود شدن عکس‌ها در فرانت‌اِند
    }),
  );

  // ۲. نسخه‌گذاری مسیرها (Best Practice برای توسعه‌های آینده و اپ موبایل)
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1', // خروجی: /api/v1/...
  });

  // ۳. تنظیمات CORS هماهنگ با Angular
  app.enableCors({
    origin: [
      'https://app.tabagheh.com',
      'http://app.tabagheh.com',
      'http://tabagheh.com',
      'https://tabagheh.com',
      'http://localhost:4200',
    ],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // ۴. محدودیت حجم درخواست برای آپلود تصاویر و مدارک
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));

  // ۵. پایپ اعتبارسنجی گلوبال (قلب تپنده امنیت DTOهای ما)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // حذف خودکار فیلدهایی که در DTO تعریف نشده‌اند
      forbidNonWhitelisted: true, // پرتاب خطا اگر فیلد اضافه‌ای فرستاده شد
      transform: true, // تبدیل خودکار تایپ‌ها (مثلاً String به Number در Query Paramها)
    }),
  );

  // ۶. سرو کردن فایل‌های آپلودی (اگر از S3 استفاده نمی‌کنی و روی سرور ذخیره میشن)
  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads/',
  });

  // ۷. مدیریت پورت داینامیک
  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🚀 Tabagheh API is running on: http://localhost:${port}/api/v1`);
}
bootstrap();
