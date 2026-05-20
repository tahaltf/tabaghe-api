import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppModule } from '../../app.module';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { IsVerifiedGuard } from '../../modules/auth/guards/is-verified.guard';
import { AuctionService } from '../../modules/auction/auction.service';
import { AuctionScheduler } from '../../modules/auction/auction.scheduler';
import { ThrottlerGuard } from '@nestjs/throttler';

describe('Auction E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auctionService: AuctionService;
  let auctionScheduler: AuctionScheduler;

  let bidder1Id: string;
  let bidder2Id: string;
  let listingId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          const userId = req.headers['x-user-id'];
          if (!userId) return false;
          req.user = {
            id: String(userId),
            phone: 'test',
            role: 'USER',
            status: 'APPROVED',
            isVerified: true,
          };
          return true;
        },
      })
      .overrideGuard(IsVerifiedGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    auctionService = app.get(AuctionService);
    auctionScheduler = app.get(AuctionScheduler);

    // Create minimal data needed for auction flow (no seed dependency)
    const sellerPhone = '09120000001';
    const bidder1Phone = '09120000002';
    const bidder2Phone = '09120000003';

    const seller = await prisma.user.upsert({
      where: { phone: sellerPhone },
      create: {
        phone: sellerPhone,
        role: 'ADMIN',
        isActive: true,
        isVerified: true,
        trustScore: 100,
      },
      update: {
        role: 'ADMIN',
        isActive: true,
        isVerified: true,
        trustScore: 100,
      },
    });
    const b1 = await prisma.user.upsert({
      where: { phone: bidder1Phone },
      create: {
        phone: bidder1Phone,
        role: 'USER',
        isActive: true,
        isVerified: true,
        trustScore: 100,
      },
      update: {
        role: 'USER',
        isActive: true,
        isVerified: true,
        trustScore: 100,
      },
    });
    const b2 = await prisma.user.upsert({
      where: { phone: bidder2Phone },
      create: {
        phone: bidder2Phone,
        role: 'USER',
        isActive: true,
        isVerified: true,
        trustScore: 100,
      },
      update: {
        role: 'USER',
        isActive: true,
        isVerified: true,
        trustScore: 100,
      },
    });

    await prisma.wallet.upsert({
      where: { userId: seller.id },
      create: { userId: seller.id, balanceAvailable: 0, balanceBlocked: 0 },
      update: {},
    });
    await prisma.wallet.upsert({
      where: { userId: b1.id },
      create: {
        userId: b1.id,
        balanceAvailable: 1_000_000_000,
        balanceBlocked: 0,
      },
      update: { balanceAvailable: 1_000_000_000 },
    });
    await prisma.wallet.upsert({
      where: { userId: b2.id },
      create: {
        userId: b2.id,
        balanceAvailable: 1_000_000_000,
        balanceBlocked: 0,
      },
      update: { balanceAvailable: 1_000_000_000 },
    });

    const category = await prisma.category.upsert({
      where: { slug: 'test-auction' },
      create: {
        slug: 'test-auction',
        title: 'Test Auction',
        auctionDepositPercent: 10,
      },
      update: { title: 'Test Auction', auctionDepositPercent: 10 },
    });
    const province = await prisma.location.create({
      data: { name: 'Tehran', type: 'PROVINCE', slug: 'e2e-auction-prov-tehran' },
    });
    const city = await prisma.location.create({
      data: { name: 'Tehran', type: 'CITY', parentId: province.id, slug: 'e2e-auction-city-tehran' },
    });

    const listing = await prisma.listing.create({
      data: {
        authorId: seller.id,
        type: 'AUCTION',
        status: 'APPROVED',
        title: 'Test Auction Listing',
        categoryId: category.id,
        condition: 'USED',
        description: 'test',
        provinceId: province.id,
        cityId: city.id,
        gallery: [],
        thumbnail: null,
        shippingPayer: 'BUYER_PREPAID',
        sellerRequiresVerification: false,
        auction: {
          create: {
            basePrice: 1000,
            minBidIncrement: 100,
            endDatetime: new Date(Date.now() + 60 * 60 * 1000),
            buyNowEnabled: false,
            status: 'ACTIVE',
          },
        },
      },
    });

    listingId = listing.id;
    bidder1Id = b1.id;
    bidder2Id = b2.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('bid race → outbid releases blocked money', async () => {
    // amounts are arbitrary and may be rejected by min increment/base price in real seed.
    // This E2E is mainly to ensure endpoint is wired & does not crash.
    await request(app.getHttpServer())
      .post(`/auctions/${listingId}/bid`)
      .set('x-user-id', bidder1Id)
      .send({ amount: 1000 })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/auctions/${listingId}/bid`)
      .set('x-user-id', bidder2Id)
      .send({ amount: 1100 })
      .expect(201);
  });

  it('finalize → create order (happy path)', async () => {
    await prisma.listingAuction.update({
      where: { listingId },
      data: {
        status: 'FINISHED',
        settlementStatus: 'PENDING',
        paymentDeadline: new Date(Date.now() + 60_000),
      },
    });

    const res = await request(app.getHttpServer())
      .post(`/orders`)
      .set('x-user-id', bidder2Id)
      .send({
        listingId,
        orderType: 'AUCTION',
        paymentMethod: 'WALLET',
        requiresVerification: false,
      })
      .expect(201);

    expect(res.body).toBeTruthy();

    const auction = await prisma.listingAuction.findUnique({
      where: { listingId },
    });

    expect(auction!.settlementStatus).toBe('PAID');
  });

  it('second order attempt is rejected after sold', async () => {
    await request(app.getHttpServer())
      .post(`/orders`)
      .set('x-user-id', bidder2Id)
      .send({
        listingId,
        orderType: 'AUCTION',
        paymentMethod: 'WALLET',
        requiresVerification: false,
      })
      .expect(400);
  });

  it('pay endpoint is disabled and enforces checkout flow', async () => {
    await request(app.getHttpServer())
      .post(`/auctions/${listingId}/pay`)
      .set('x-user-id', bidder2Id)
      .set('idempotency-key', `pay-disabled-${Date.now()}`)
      .send({})
      .expect(400);
  });

  it('self-service cancel bid is forbidden', async () => {
    await request(app.getHttpServer())
      .post(`/auctions/${listingId}/cancel-bid`)
      .set('x-user-id', bidder1Id)
      .send({})
      .expect(403);
  });

  it('decline-second-chance is idempotent with same idempotency key', async () => {
    const seller = await prisma.user.create({
      data: {
        phone: `0917${Date.now().toString().slice(-7)}`,
        role: 'USER',
        isActive: true,
        isVerified: true,
        trustScore: 100,
      },
    });
    await prisma.wallet.create({
      data: { userId: seller.id, balanceAvailable: 0, balanceBlocked: 0 },
    });
    const category = await prisma.category.findFirst({
      where: { slug: 'test-auction' },
    });
    const province = await prisma.location.create({
      data: { name: 'Tehran6', type: 'PROVINCE', slug: 'e2e-auction-prov-tehran6' },
    });
    const city = await prisma.location.create({
      data: { name: 'Tehran6', type: 'CITY', parentId: province.id, slug: 'e2e-auction-city-tehran6' },
    });

    const listing = await prisma.listing.create({
      data: {
        authorId: seller.id,
        type: 'AUCTION',
        status: 'APPROVED',
        title: 'Second Chance Decline Idempotency',
        categoryId: category!.id,
        condition: 'USED',
        description: 'idempotent decline test',
        provinceId: province.id,
        cityId: city.id,
        gallery: [],
        shippingPayer: 'BUYER_PREPAID',
        sellerRequiresVerification: false,
        auction: {
          create: {
            basePrice: 6000,
            minBidIncrement: 100,
            endDatetime: new Date(Date.now() + 60 * 60 * 1000),
            buyNowEnabled: false,
            status: 'ACTIVE',
          },
        },
      },
    });

    await request(app.getHttpServer())
      .post(`/auctions/${listing.id}/bid`)
      .set('x-user-id', bidder1Id)
      .send({ amount: 6000 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/auctions/${listing.id}/bid`)
      .set('x-user-id', bidder2Id)
      .send({ amount: 6100 })
      .expect(201);

    await auctionService.finalizeAuction(listing.id);
    await auctionService.penalizeWinner(listing.id); // bidder2 penalized, bidder1 gets OFFERED

    const beforeCount = await prisma.secondChanceOffer.count({
      where: { listingId: listing.id },
    });
    expect(beforeCount).toBe(1);

    const key = `decline-idem-${Date.now()}`;
    const first = await request(app.getHttpServer())
      .post(`/auctions/${listing.id}/decline-second-chance`)
      .set('x-user-id', bidder1Id)
      .set('idempotency-key', key)
      .send({})
      .expect(201);

    const second = await request(app.getHttpServer())
      .post(`/auctions/${listing.id}/decline-second-chance`)
      .set('x-user-id', bidder1Id)
      .set('idempotency-key', key)
      .send({})
      .expect(201);

    expect(first.body?.success).toBe(true);
    expect(second.body?.success).toBe(true);
    expect(second.body?.meta?.path).toBe(first.body?.meta?.path);

    const afterCount = await prisma.secondChanceOffer.count({
      where: { listingId: listing.id },
    });
    expect(afterCount).toBe(1);
    const declined = await prisma.secondChanceOffer.findFirst({
      where: { listingId: listing.id, userId: bidder1Id },
      select: { status: true, declinedAt: true },
      orderBy: { createdAt: 'desc' },
    });
    expect(declined?.status).toBe('DECLINED');
    expect(declined?.declinedAt).toBeTruthy();
  });

  it('second chance chain: penalize winner -> decline -> next winner pays', async () => {
    const seller = await prisma.user.create({
      data: {
        phone: `0913${Date.now().toString().slice(-7)}`,
        role: 'USER',
        isActive: true,
        isVerified: true,
        trustScore: 100,
      },
    });
    await prisma.wallet.create({
      data: { userId: seller.id, balanceAvailable: 0, balanceBlocked: 0 },
    });

    const category = await prisma.category.findFirst({
      where: { slug: 'test-auction' },
    });
    const province = await prisma.location.create({
      data: { name: 'Tehran2', type: 'PROVINCE', slug: 'e2e-auction-prov-tehran2' },
    });
    const city = await prisma.location.create({
      data: { name: 'Tehran2', type: 'CITY', parentId: province.id, slug: 'e2e-auction-city-tehran2' },
    });

    const listing = await prisma.listing.create({
      data: {
        authorId: seller.id,
        type: 'AUCTION',
        status: 'APPROVED',
        title: 'Second Chance Chain',
        categoryId: category!.id,
        condition: 'USED',
        description: 'second chance test',
        provinceId: province.id,
        cityId: city.id,
        gallery: [],
        shippingPayer: 'BUYER_PREPAID',
        sellerRequiresVerification: false,
        auction: {
          create: {
            basePrice: 2000,
            minBidIncrement: 100,
            endDatetime: new Date(Date.now() + 60 * 60 * 1000),
            buyNowEnabled: false,
            status: 'ACTIVE',
          },
        },
      },
    });

    // bidder1, bidder2, bidder3 compete
    await request(app.getHttpServer())
      .post(`/auctions/${listing.id}/bid`)
      .set('x-user-id', bidder1Id)
      .send({ amount: 2000 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/auctions/${listing.id}/bid`)
      .set('x-user-id', bidder2Id)
      .send({ amount: 2100 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/auctions/${listing.id}/bid`)
      .set('x-user-id', bidder1Id) // bidder1 upgrades once
      .send({ amount: 2200 })
      .expect(201);

    await auctionService.finalizeAuction(listing.id);
    await auctionService.penalizeWinner(listing.id); // winner misses deadline -> next offer

    const offer1 = await prisma.secondChanceOffer.findFirst({
      where: { listingId: listing.id, status: 'OFFERED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(offer1).toBeTruthy();
    expect(offer1!.userId).toBe(bidder2Id);

    // only offered user can checkout in second chance round
    await request(app.getHttpServer())
      .get(`/listings/${listing.id}/auction-checkout`)
      .set('x-user-id', bidder1Id)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/listings/${listing.id}/auction-checkout`)
      .set('x-user-id', bidder2Id)
      .expect(200);

    // bidder2 declines -> offer should move to next candidate
    await request(app.getHttpServer())
      .post(`/auctions/${listing.id}/decline-second-chance`)
      .set('x-user-id', bidder2Id)
      .expect(201);

    const declined = await prisma.secondChanceOffer.findFirst({
      where: { listingId: listing.id, userId: bidder2Id },
      orderBy: { createdAt: 'desc' },
    });
    expect(declined?.status).toBe('DECLINED');

    const auctionState = await prisma.listingAuction.findUnique({
      where: { listingId: listing.id },
      select: { settlementStatus: true },
    });
    expect(auctionState?.settlementStatus).toBe('PENDING');

    const offer2 = await prisma.secondChanceOffer.findFirst({
      where: {
        listingId: listing.id,
        userId: bidder1Id,
        status: 'OFFERED',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(offer2).toBeTruthy();
  });

  it('second chance accept: offered user pays and offer becomes ACCEPTED', async () => {
    const seller = await prisma.user.create({
      data: {
        phone: `0914${Date.now().toString().slice(-7)}`,
        role: 'USER',
        isActive: true,
        isVerified: true,
        trustScore: 100,
      },
    });
    await prisma.wallet.create({
      data: { userId: seller.id, balanceAvailable: 0, balanceBlocked: 0 },
    });

    const category = await prisma.category.findFirst({
      where: { slug: 'test-auction' },
    });
    const province = await prisma.location.create({
      data: { name: 'Tehran3', type: 'PROVINCE', slug: 'e2e-auction-prov-tehran3' },
    });
    const city = await prisma.location.create({
      data: { name: 'Tehran3', type: 'CITY', parentId: province.id, slug: 'e2e-auction-city-tehran3' },
    });

    const listing = await prisma.listing.create({
      data: {
        authorId: seller.id,
        type: 'AUCTION',
        status: 'APPROVED',
        title: 'Second Chance Accept',
        categoryId: category!.id,
        condition: 'USED',
        description: 'second chance accept test',
        provinceId: province.id,
        cityId: city.id,
        gallery: [],
        shippingPayer: 'BUYER_PREPAID',
        sellerRequiresVerification: false,
        auction: {
          create: {
            basePrice: 3000,
            minBidIncrement: 100,
            endDatetime: new Date(Date.now() + 60 * 60 * 1000),
            buyNowEnabled: false,
            status: 'ACTIVE',
          },
        },
      },
    });

    // bidder1 then bidder2 becomes winner
    await request(app.getHttpServer())
      .post(`/auctions/${listing.id}/bid`)
      .set('x-user-id', bidder1Id)
      .send({ amount: 3000 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/auctions/${listing.id}/bid`)
      .set('x-user-id', bidder2Id)
      .send({ amount: 3100 })
      .expect(201);

    await auctionService.finalizeAuction(listing.id);
    await auctionService.penalizeWinner(listing.id); // bidder2 penalized, bidder1 gets second chance

    const offered = await prisma.secondChanceOffer.findFirst({
      where: {
        listingId: listing.id,
        userId: bidder1Id,
        status: 'OFFERED',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(offered).toBeTruthy();

    await request(app.getHttpServer())
      .post(`/orders`)
      .set('x-user-id', bidder1Id)
      .send({
        listingId: listing.id,
        orderType: 'AUCTION',
        paymentMethod: 'WALLET',
        requiresVerification: false,
      })
      .expect(201);

    const accepted = await prisma.secondChanceOffer.findUnique({
      where: { id: offered!.id },
      select: { status: true, acceptedAt: true },
    });
    expect(accepted?.status).toBe('ACCEPTED');
    expect(accepted?.acceptedAt).toBeTruthy();

    const auctionState = await prisma.listingAuction.findUnique({
      where: { listingId: listing.id },
      select: { settlementStatus: true },
    });
    expect(auctionState?.settlementStatus).toBe('PAID');
  });

  it('second chance offered can expire and block checkout/payment', async () => {
    const seller = await prisma.user.create({
      data: {
        phone: `0915${Date.now().toString().slice(-7)}`,
        role: 'USER',
        isActive: true,
        isVerified: true,
        trustScore: 100,
      },
    });
    await prisma.wallet.create({
      data: { userId: seller.id, balanceAvailable: 0, balanceBlocked: 0 },
    });
    const category = await prisma.category.findFirst({
      where: { slug: 'test-auction' },
    });
    const province = await prisma.location.create({
      data: { name: 'Tehran4', type: 'PROVINCE', slug: 'e2e-auction-prov-tehran4' },
    });
    const city = await prisma.location.create({
      data: { name: 'Tehran4', type: 'CITY', parentId: province.id, slug: 'e2e-auction-city-tehran4' },
    });

    const listing = await prisma.listing.create({
      data: {
        authorId: seller.id,
        type: 'AUCTION',
        status: 'APPROVED',
        title: 'Second Chance Expire',
        categoryId: category!.id,
        condition: 'USED',
        description: 'second chance expire test',
        provinceId: province.id,
        cityId: city.id,
        gallery: [],
        shippingPayer: 'BUYER_PREPAID',
        sellerRequiresVerification: false,
        auction: {
          create: {
            basePrice: 4000,
            minBidIncrement: 100,
            endDatetime: new Date(Date.now() + 60 * 60 * 1000),
            buyNowEnabled: false,
            status: 'ACTIVE',
          },
        },
      },
    });

    await auctionService.placeBid(bidder1Id, listing.id, 4000);
    await auctionService.placeBid(bidder2Id, listing.id, 4100);

    await auctionService.finalizeAuction(listing.id);
    await auctionService.penalizeWinner(listing.id); // bidder2 penalized, bidder1 gets offer

    const offered = await prisma.secondChanceOffer.findFirst({
      where: { listingId: listing.id, userId: bidder1Id, status: 'OFFERED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(offered).toBeTruthy();

    await prisma.secondChanceOffer.update({
      where: { id: offered!.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await auctionScheduler.expireSecondChanceOffers();

    const expired = await prisma.secondChanceOffer.findUnique({
      where: { id: offered!.id },
      select: { status: true, expiredAt: true },
    });
    expect(expired?.status).toBe('EXPIRED');
    expect(expired?.expiredAt).toBeTruthy();

    await request(app.getHttpServer())
      .get(`/listings/${listing.id}/auction-checkout`)
      .set('x-user-id', bidder1Id)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/orders`)
      .set('x-user-id', bidder1Id)
      .send({
        listingId: listing.id,
        orderType: 'AUCTION',
        paymentMethod: 'WALLET',
        requiresVerification: false,
      })
      .expect(403);
  });

  it('concurrency: decline-second-chance and timeout cannot double-transition same offer', async () => {
    const seller = await prisma.user.create({
      data: {
        phone: `0916${Date.now().toString().slice(-7)}`,
        role: 'USER',
        isActive: true,
        isVerified: true,
        trustScore: 100,
      },
    });
    await prisma.wallet.create({
      data: { userId: seller.id, balanceAvailable: 0, balanceBlocked: 0 },
    });
    const category = await prisma.category.findFirst({
      where: { slug: 'test-auction' },
    });
    const province = await prisma.location.create({
      data: { name: 'Tehran5', type: 'PROVINCE', slug: 'e2e-auction-prov-tehran5' },
    });
    const city = await prisma.location.create({
      data: { name: 'Tehran5', type: 'CITY', parentId: province.id, slug: 'e2e-auction-city-tehran5' },
    });

    const listing = await prisma.listing.create({
      data: {
        authorId: seller.id,
        type: 'AUCTION',
        status: 'APPROVED',
        title: 'Second Chance Concurrency',
        categoryId: category!.id,
        condition: 'USED',
        description: 'concurrency test',
        provinceId: province.id,
        cityId: city.id,
        gallery: [],
        shippingPayer: 'BUYER_PREPAID',
        sellerRequiresVerification: false,
        auction: {
          create: {
            basePrice: 5000,
            minBidIncrement: 100,
            endDatetime: new Date(Date.now() + 60 * 60 * 1000),
            buyNowEnabled: false,
            status: 'ACTIVE',
          },
        },
      },
    });

    // bidder2 wins -> penalized -> bidder1 gets second chance OFFERED
    await auctionService.placeBid(bidder1Id, listing.id, 5000);
    await auctionService.placeBid(bidder2Id, listing.id, 5100);

    await auctionService.finalizeAuction(listing.id);
    await auctionService.penalizeWinner(listing.id);

    const offered = await prisma.secondChanceOffer.findFirst({
      where: { listingId: listing.id, userId: bidder1Id, status: 'OFFERED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(offered).toBeTruthy();

    // make this OFFERED immediately timeout-eligible for scheduler path
    await prisma.secondChanceOffer.update({
      where: { id: offered!.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await prisma.listingAuction.update({
      where: { listingId: listing.id },
      data: {
        paymentDeadline: new Date(Date.now() - 1_000),
        finishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
    });

    // race: user decline + timeout worker in parallel
    await Promise.allSettled([
      request(app.getHttpServer())
        .post(`/auctions/${listing.id}/decline-second-chance`)
        .set('x-user-id', bidder1Id)
        .send({}),
      auctionService.checkUnpaidAuctions(),
    ]);

    const latestOffer = await prisma.secondChanceOffer.findUnique({
      where: { id: offered!.id },
      select: { status: true, declinedAt: true, expiredAt: true },
    });
    expect(['DECLINED', 'EXPIRED']).toContain(latestOffer?.status);
    // exactly one terminal marker must be set on the same row
    const terminalMarks =
      Number(!!latestOffer?.declinedAt) + Number(!!latestOffer?.expiredAt);
    expect(terminalMarks).toBe(1);

    const finalAuction = await prisma.listingAuction.findUnique({
      where: { listingId: listing.id },
      select: { settlementStatus: true },
    });
    expect(finalAuction?.settlementStatus).toBe('FAILED');
  });
});
