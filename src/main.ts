import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ۱. اول تنظیمات CORS را اعمال کن
  app.enableCors({
    origin: ['https://app.tabagheh.com', 'http://app.tabagheh.com'],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // ۲. حالا سرور را استارت بزن
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
