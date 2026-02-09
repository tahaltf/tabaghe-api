import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { join } from 'path';
import * as express from 'express';
import { json, urlencoded } from 'express';
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // ۱. تنظیمات CORS (حتماً قبل از listen باشد)
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

  // تنظیمات اضافی برای بدنه درخواست‌ها (اگر نیاز داشتی)
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));

  // ۲. حالا سرور را استارت بزن
  // await app.listen(process.env.PORT ?? 3000);
  console.log(process.env.PORT);
  await app.listen(3000);
}
bootstrap();
