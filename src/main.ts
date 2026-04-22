import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  BadRequestException,
  ValidationError,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { join } from 'path';

function flattenValidationErrors(errors: ValidationError[], parent = ''): string[] {
  const out: string[] = [];
  for (const err of errors) {
    const prop = parent ? `${parent}.${err.property}` : err.property;
    if (err.constraints) {
      for (const msg of Object.values(err.constraints)) {
        out.push(`${prop} ${msg}`);
      }
    }
    if (err.children && err.children.length) {
      out.push(...flattenValidationErrors(err.children, prop));
    }
  }
  return out;
}

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

  const corsOrigins = (process.env.FRONTEND_ORIGINS || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

  // ۳. تنظیمات CORS هماهنگ با Angular
  app.enableCors({
    origin: corsOrigins.length
      ? corsOrigins
      : [
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
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: (errors: ValidationError[]) =>
        new BadRequestException({
          message: flattenValidationErrors(errors),
          error: 'ValidationError',
          statusCode: 400,
        }),
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
