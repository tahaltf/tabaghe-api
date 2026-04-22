import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, VersioningType } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * نیاز به DATABASE_URL معتبر دارد (Prisma در بوت‌استرپ).
 * مسیرها باید با main.ts هم‌خوان باشند: prefix ‎`api`‎ + نسخه ‎`v1`‎.
 */
describe('App (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/v1 — hello با envelope موفق', () => {
    return request(app.getHttpServer())
      .get('/api/v1')
      .expect(200)
      .expect((res) => {
        expect(res.body?.success).toBe(true);
        expect(res.body?.data).toBe('Hello World!');
        expect(res.body?.error).toBeNull();
      });
  });
});
