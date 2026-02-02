import * as request from 'supertest';

export async function login(app, phone: string, password: string) {
    const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ phone, password });

    return res.body.accessToken;
}

export function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
}
