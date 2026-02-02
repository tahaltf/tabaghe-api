import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { join } from 'path';
import * as express from 'express';
import { json, urlencoded } from 'express';
import { NestExpressApplication } from '@nestjs/platform-express';
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule); // تغییر این خط
  // تنظیم دقیق مسیر برای دسترسی به فایل‌ها
  // process.cwd() به پوشه اصلی پروژه (جایی که package.json هست) اشاره می‌کند
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/', // پیشوندی که در URL استفاده می‌شود
  });

  app.enableCors();
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ limit: '50mb', extended: true }));
  await app.listen(3000);
}
bootstrap();
