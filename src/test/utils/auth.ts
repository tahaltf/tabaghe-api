import * as request from 'supertest';

/** ورود ادمین دو مرحله‌ای در تست‌ها (رمز + OTP تست) */
export async function login(app, phone: string, password: string) {
  const step1 = await request(app.getHttpServer())
    .post('/auth/login-password')
    .send({ username: phone, password });

  const challengeToken = step1.body?.challengeToken;
  if (!challengeToken) {
    throw new Error(
      `Admin login step1 failed: ${JSON.stringify(step1.body)}`,
    );
  }

  const step2 = await request(app.getHttpServer())
    .post('/auth/admin/verify-otp')
    .send({ challengeToken, code: '11111' });

  return step2.body.accessToken;
}

export function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}
