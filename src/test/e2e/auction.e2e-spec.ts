import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {PrismaService} from "../../prisma/prisma.service";
import {AppModule} from "../../app.module";
import {auth, login} from "../utils/auth";


describe('Auction E2E', () => {
    let app: INestApplication;
    let prisma: PrismaService;

    let sellerToken: string;
    let bidder1Token: string;
    let bidder2Token: string;
    let listingId: string;

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        app = moduleRef.createNestApplication();
        await app.init();

        prisma = app.get(PrismaService);

        sellerToken = await login(app, '09120000001', 'password');
        bidder1Token = await login(app, '09120000002', 'password');
        bidder2Token = await login(app, '09120000003', 'password');

        // assume listing + auction already created in seed
        const auction = await prisma.listingAuction.findFirst({
            where: { status: 'ACTIVE' },
        });
        listingId = auction!.listingId;
    });

    afterAll(async () => {
        await app.close();
    });

    it('bid race → outbid releases blocked money', async () => {
        await request(app.getHttpServer())
            .post(`/auctions/${listingId}/bid`)
            .set(auth(bidder1Token))
            .send({ amount: 1000 })
            .expect(201);

        await request(app.getHttpServer())
            .post(`/auctions/${listingId}/bid`)
            .set(auth(bidder2Token))
            .send({ amount: 1100 })
            .expect(201);

        const wallet1 = await prisma.wallet.findUnique({
            where: { userId: 'bidder1-id' },
        });

        expect(wallet1!.balanceBlocked.toNumber()).toBe(0);
    });

    it('finalize → pay (happy path)', async () => {
        // simulate finalize
        await prisma.listingAuction.update({
            where: { listingId },
            data: {
                status: 'FINISHED',
                settlementStatus: 'PENDING',
                paymentDeadline: new Date(Date.now() + 60_000),
            },
        });

        const res = await request(app.getHttpServer())
            .post(`/auctions/${listingId}/pay`)
            .set(auth(bidder2Token))
            .set('Idempotency-Key', 'pay-1')
            .expect(201);

        expect(res.body.ok).toBe(true);

        const auction = await prisma.listingAuction.findUnique({
            where: { listingId },
        });

        expect(auction!.settlementStatus).toBe('PAID');
    });

    it('idempotency → double pay returns same response', async () => {
        const res1 = await request(app.getHttpServer())
            .post(`/auctions/${listingId}/pay`)
            .set(auth(bidder2Token))
            .set('Idempotency-Key', 'pay-duplicate')
            .expect(201);

        const res2 = await request(app.getHttpServer())
            .post(`/auctions/${listingId}/pay`)
            .set(auth(bidder2Token))
            .set('Idempotency-Key', 'pay-duplicate')
            .expect(201);

        expect(res1.body).toEqual(res2.body);
    });
});
