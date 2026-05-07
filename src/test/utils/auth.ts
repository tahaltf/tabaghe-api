import * as request from 'supertest';

export async function login(app, phone: string, password: string) {
    const res = await request(app.getHttpServer())
        .post('/auth/login-password')
        .send({ username: phone, password });

    return res.body.accessToken;
}

export function auth(token: string) {
    return { authorization: `Bearer ${token}` };
}
