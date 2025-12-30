import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as crypto from 'crypto';
import helmet from 'helmet';

import { validateEnv } from './config/env';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

(global as any).crypto = crypto;

async function bootstrap() {
    validateEnv();

    const app = await NestFactory.create(AppModule);

    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }),
    );

    app.useGlobalFilters(new AllExceptionsFilter());

    // 🔒 Security
    app.use(
        helmet({
            contentSecurityPolicy: false,
        }),
    );

    app.enableCors({
        origin: true,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    });

    app.getHttpAdapter().getInstance().disable('x-powered-by');

    app.enableShutdownHooks();

    const port = Number(process.env.PORT || 3000);
    await app.listen(port);
}
bootstrap();
