import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { validateProductionEnv, validateRedisEnv } from './config/env';
import {
  BadRequestException,
  RequestMethod,
  ValidationError,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { join } from 'path';
import { createServer } from 'node:net';
import { CampaignPrefixService } from './modules/tracking/campaign-prefix.service';
import { PrismaService } from './infrastructure/prisma/prisma.service';
import { normalizeCampaignUrlPrefix } from './common/campaign/campaign-url.util';
import { buildCorsOrigins } from './config/cors-origins.util';
import { RedisIoAdapter } from './infrastructure/websocket/redis-io.adapter';

/** ترجمهٔ پیام‌های پیش‌فرض class-validator برای نمایش به کاربر نهایی */
function translateValidationConstraintMessage(raw: string): string {
  let m = raw.trim();
  const fullLine = [
    [
      /^property ([a-zA-Z0-9_.]+) should not exist$/i,
      (_: string, g1: string) => `فیلد «${g1}» در این درخواست مجاز نیست`,
    ],
    [
      /^nested property (.+) must be either object or array$/i,
      (_: string, g1: string) => `فیلد تو در تو «${g1}» باید شی یا آرایه باشد`,
    ],
    [
      /^each value in nested property (.+) must be either object or array$/i,
      (_: string, g1: string) =>
        `هر مقدار در فیلد تو در تو «${g1}» باید شی یا آرایه باشد`,
    ],
  ] as const;
  for (const [re, repl] of fullLine) {
    const match = re.exec(m);
    if (match) return repl(match[0], match[1]);
  }

  const phrasePairs: Array<[RegExp, string]> = [
    [
      /must be longer than or equal to (\d+) characters/gi,
      'طول باید حداقل $1 کاراکتر باشد',
    ],
    [
      /must be shorter than or equal to (\d+) characters/gi,
      'طول باید حداکثر $1 کاراکتر باشد',
    ],
    [
      /must be a number conforming to the specified constraints/gi,
      'باید عدد معتبر باشد',
    ],
    [/must be an integer number/gi, 'باید عدد صحیح باشد'],
    [/must be a positive number/gi, 'باید عدد مثبت باشد'],
    [/must be a negative number/gi, 'باید عدد منفی باشد'],
    [/must be a boolean value/gi, 'باید مقدار صحیح یا غلط باشد'],
    [/must be a string/gi, 'باید متن باشد'],
    [/must be a number/gi, 'باید عدد باشد'],
    [/must be an email/gi, 'باید ایمیل معتبر باشد'],
    [/must be a UUID/gi, 'باید شناسه یکتا (UUID) معتبر باشد'],
    [/must be a URL address/gi, 'باید آدرس اینترنتی معتبر باشد'],
    [/must be a Date instance/gi, 'باید تاریخ معتبر باشد'],
    [/should not be empty/gi, 'نباید خالی باشد'],
    [/must not be less than ([0-9.]+)/gi, 'نباید کمتر از $1 باشد'],
    [/must not be greater than ([0-9.]+)/gi, 'نباید بیشتر از $1 باشد'],
    [
      /must match \/(.*)\/ regular expression/gi,
      'با قالب درخواستی مطابقت ندارد',
    ],
    [/is not valid phone number/gi, 'شماره تلفن معتبر نیست'],
    [/is not a valid phone number/gi, 'شماره تلفن معتبر نیست'],
  ];
  for (const [re, fa] of phrasePairs) {
    m = m.replace(re, fa);
  }
  return m;
}

/** برچسب خوانا برای فیلدهای رایج؛ وقتی کلاینت فیلدی نامجاز می‌فرستد (forbidNonWhitelisted). */
const FORBIDDEN_FIELD_LABELS: Record<string, string> = {
  // آگهی ثابت
  'direct.price': 'قیمت در بخش «آگهی ثابت»',
  'direct.allowExchange': 'گزینهٔ معاوضه در بخش «آگهی ثابت»',
  'direct.shippingMethods': 'روش‌های ارسال در بخش «آگهی ثابت»',
  // معاوضه
  'exchange.desiredCategoryId': 'دستهٔ کالای موردنظر در بخش «معاوضه»',
  'exchange.desiredTitle': 'عنوان کالای موردنظر در بخش «معاوضه»',
  'exchange.desiredDescription': 'توضیح کالای موردنظر در بخش «معاوضه»',
  'exchange.ownValue': 'ارزش کالای خودتان در بخش «معاوضه»',
  'exchange.extraPaymentAmount': 'مبلغ پرداخت اضافی در بخش «معاوضه»',
  'exchange.acceptOtherItems': 'پذیرش سایر کالاها در بخش «معاوضه»',
  'exchange.allowDirectSale': 'امکان فروش مستقیم در بخش «معاوضه»',
  'exchange.directPrice': 'قیمت فروش مستقیم در بخش «معاوضه»',
  // مزایده
  'auction.basePrice': 'قیمت پایه در بخش «مزایده»',
  'auction.minBidIncrement': 'حداقل افزایش پیشنهاد در بخش «مزایده»',
  'auction.endDatetime': 'زمان پایان در بخش «مزایده»',
  'auction.buyNowEnabled': 'فعال‌سازی خرید فوری در بخش «مزایده»',
  'auction.buyNowPrice': 'قیمت خرید فوری در بخش «مزایده»',
};

const WHITELIST_VIOLATION_RE = /^property [a-zA-Z0-9_.]+ should not exist$/i;

function labelForForbiddenPath(propPath: string): string {
  return FORBIDDEN_FIELD_LABELS[propPath] ?? `«${propPath}»`;
}

/** چند خطای forbidNonWhitelisted را یکی می‌کند تا همان جملهٔ طولانی تکرار نشود. */
function mergeWhitelistViolationMessages(paths: string[]): string | null {
  const unique = [...new Set(paths)];
  if (unique.length === 0) return null;
  const labels = unique.map(labelForForbiddenPath);
  if (labels.length === 1) {
    return `${labels[0]} را در این درخواست نفرستید؛ با نوع آگهی یا این عملیات هم‌خوان نیست.`;
  }
  return `این موارد را با هم نفرستید: ${labels.join('، ')}. همگی با نوع آگهی یا این عملیات هم‌خوان نیستند.`;
}

function collectValidationMessages(
  errors: ValidationError[],
  parent = '',
): { whitelistPaths: string[]; otherLines: string[] } {
  const whitelistPaths: string[] = [];
  const otherLines: string[] = [];
  for (const err of errors) {
    const prop = parent ? `${parent}.${err.property}` : err.property;
    if (err.constraints) {
      for (const msg of Object.values(err.constraints)) {
        const raw = msg.trim();
        if (WHITELIST_VIOLATION_RE.test(raw)) {
          whitelistPaths.push(prop);
        } else {
          otherLines.push(
            `${prop} ${translateValidationConstraintMessage(msg)}`,
          );
        }
      }
    }
    if (err.children?.length) {
      const nested = collectValidationMessages(err.children, prop);
      whitelistPaths.push(...nested.whitelistPaths);
      otherLines.push(...nested.otherLines);
    }
  }
  return { whitelistPaths, otherLines };
}

function flattenValidationErrors(errors: ValidationError[]): string[] {
  const { whitelistPaths, otherLines } = collectValidationMessages(errors);
  const merged = mergeWhitelistViolationMessages(whitelistPaths);
  const out: string[] = [];
  if (merged) out.push(merged);
  out.push(...otherLines);
  return out;
}

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = createServer();
    tester
      .once('error', () => resolve(false))
      .once('listening', () => {
        tester.close(() => resolve(true));
      })
      // بدون host تا مثل Express/Nest روی همان ترکیب IPv4/IPv6 گوش کند؛
      // listen(3000,'0.0.0.0') گاهی در حالی که ::3000 اشغال است اشتباه «آزاد» برمی‌گرداند.
      .listen(port);
  });
}

async function resolveAvailablePort(
  startPort: number,
  maxAttempts: number,
): Promise<number> {
  let candidate = startPort;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await isPortFree(candidate)) return candidate;
    candidate += 1;
  }
  throw new Error(
    `Could not find an available port from ${startPort} to ${candidate - 1}.`,
  );
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.set('trust proxy', true);

  try {
    const redisUrl = validateRedisEnv();
    if (redisUrl) {
      const redisIo = new RedisIoAdapter(app);
      redisIo.connectToRedis(redisUrl);
      app.useWebSocketAdapter(redisIo);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(
      `[bootstrap] Socket.io Redis adapter skipped: ${message}`,
    );
  }

  if (process.env.NODE_ENV === 'production') {
    validateProductionEnv();
  }

  // ۱. امنیت: جلوگیری از حملات رایج وب با تنظیم هدرهای HTTP
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // برای لود شدن عکس‌ها در فرانت‌اِند
    }),
  );

  // ۲. نسخه‌گذاری مسیرها (Best Practice برای توسعه‌های آینده و اپ موبایل)
  const campaignPrefixService = app.get(CampaignPrefixService);
  await campaignPrefixService.refresh();
  const campaignRouteExcludes = campaignPrefixService
    .getRoutePrefixes()
    .map((p) => ({ path: `${p}/:slug`, method: RequestMethod.GET }));

  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'sitemap.xml', method: RequestMethod.GET },
      { path: 'sitemap-:part.xml', method: RequestMethod.GET },
      { path: 'robots.txt', method: RequestMethod.GET },
      { path: 'manifest.webmanifest', method: RequestMethod.GET },
      { path: 'pwa/apple-touch-icon.png', method: RequestMethod.GET },
      { path: 'pwa/icon-192.png', method: RequestMethod.GET },
      { path: 'pwa/icon-512.png', method: RequestMethod.GET },
      { path: 'pwa/icon', method: RequestMethod.GET },
      { path: 'pwa/favicon.png', method: RequestMethod.GET },
      { path: 'favicon.ico', method: RequestMethod.GET },
      ...campaignRouteExcludes,
    ],
  });
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1', // خروجی: /api/v1/...
  });

  const frontendAppUrl = (
    process.env.FRONTEND_APP_URL || 'https://tabagheh.com'
  ).trim();
  const corsOrigins = buildCorsOrigins(frontendAppUrl);

  // ۳. تنظیمات CORS هماهنگ با Angular
  app.enableCors({
    origin: corsOrigins.length
      ? corsOrigins
      : [
          frontendAppUrl,
          'http://localhost:4200',
          'https://tabagheh.com',
          'https://www.tabagheh.com',
        ],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS', // حتما OPTIONS اضافه شود
    credentials: true,
  });

  // ۴. محدودیت حجم درخواست برای آپلود تصاویر و مدارک
  app.use(json({ limit: '20mb' }));
  app.use(urlencoded({ extended: true, limit: '20mb' }));

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
          error: 'خطای اعتبارسنجی',
          statusCode: 400,
        }),
    }),
  );

  // ۶. سرو کردن فایل‌های آپلودی (اگر از S3 استفاده نمی‌کنی و روی سرور ذخیره میشن)
  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads/',
  });

  // ۷. مدیریت پورت: اگر پورت اشغال بود، خودکار روی پورت بعدی بالا بیاید
  const preferredPort = Number(process.env.PORT || 3000);
  const maxPortAttempts = 10;
  const activePort = await resolveAvailablePort(preferredPort, maxPortAttempts);

  await app.listen(activePort);
  console.log(
    `🚀 Tabagheh API is running on: http://localhost:${activePort}/api/v1`,
  );
  if (activePort !== preferredPort) {
    console.warn(
      `⚠️ Preferred port ${preferredPort} was busy. Switched to port ${activePort}.`,
    );
  }
}
bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
