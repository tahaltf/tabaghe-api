import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { IsVerifiedGuard } from '../../modules/auth/guards/is-verified.guard';
import { UserAwareThrottlerGuard } from '../../common/guards/user-aware-throttler.guard';

describe('Exchange E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let ownerId: string;
  let offerer1Id: string;
  let offerer2Id: string;
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
      .overrideGuard(UserAwareThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const owner = await prisma.user.upsert({
      where: { phone: '09120001001' },
      create: {
        phone: '09120001001',
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
    const offerer1 = await prisma.user.upsert({
      where: { phone: '09120001002' },
      create: {
        phone: '09120001002',
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
    const offerer2 = await prisma.user.upsert({
      where: { phone: '09120001003' },
      create: {
        phone: '09120001003',
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

    ownerId = owner.id;
    offerer1Id = offerer1.id;
    offerer2Id = offerer2.id;

    await prisma.wallet.upsert({
      where: { userId: ownerId },
      create: { userId: ownerId, balanceAvailable: 0, balanceBlocked: 0 },
      update: {},
    });
    await prisma.wallet.upsert({
      where: { userId: offerer1Id },
      create: { userId: offerer1Id, balanceAvailable: 0, balanceBlocked: 0 },
      update: {},
    });
    await prisma.wallet.upsert({
      where: { userId: offerer2Id },
      create: { userId: offerer2Id, balanceAvailable: 0, balanceBlocked: 0 },
      update: {},
    });

    const category = await prisma.category.upsert({
      where: { slug: 'test-exchange' },
      create: { slug: 'test-exchange', title: 'Test Exchange' },
      update: { title: 'Test Exchange' },
    });
    const locSuffix = Date.now();
    const province = await prisma.location.create({
      data: {
        name: `Tehran-ex-${locSuffix}`,
        type: 'PROVINCE',
        slug: `e2e-exchange-prov-${locSuffix}`,
      },
    });
    const city = await prisma.location.create({
      data: {
        name: `Tehran-ex-city-${locSuffix}`,
        type: 'CITY',
        parentId: province.id,
        slug: `e2e-exchange-city-${locSuffix}`,
      },
    });

    const listing = await prisma.listing.create({
      data: {
        authorId: ownerId,
        type: 'DIRECT',
        status: 'APPROVED',
        title: 'Direct listing allowExchange',
        categoryId: category.id,
        condition: 'USED',
        description: 'test',
        provinceId: province.id,
        cityId: city.id,
        gallery: [],
        thumbnail: null,
        shippingPayer: 'BUYER_PREPAID',
        sellerRequiresVerification: false,
        direct: {
          create: {
            price: 100_000,
            allowExchange: true,
          },
        },
      },
    });

    listingId = listing.id;
  });

  const unwrap = <T>(body: any): T => {
    // Some endpoints are returned as-is, some are wrapped like { data }, and some may be double-wrapped.
    let cur: any = body;
    for (let i = 0; i < 3; i++) {
      if (cur && typeof cur === 'object' && 'data' in cur) cur = cur.data;
      else break;
    }
    return cur as T;
  };

  const pickOffersPayload = (body: any): { items: any[] } => {
    // Be defensive across possible response wrappers.
    const candidates = [
      body,
      body?.data,
      body?.data?.data,
      body?.data?.result,
      body?.result,
    ];
    for (const c of candidates) {
      if (c && typeof c === 'object' && Array.isArray((c as any).items))
        return c as any;
    }
    // In this codebase, paginated endpoints are enveloped as { success, data: items[], meta: { pagination } }
    if (body && typeof body === 'object' && Array.isArray(body.data)) {
      return { items: body.data };
    }
    return body as any;
  };

  afterAll(async () => {
    await app.close();
  });

  it('offer creation: happy path (no images)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/exchange/${listingId}/offers`)
      .set('x-user-id', offerer1Id)
      .field('title', 'My offer')
      .field('description', 'Offer description')
      .field('extraPayment', '0')
      .field('payerRole', 'OFFERER')
      .expect(201);

    const offer = unwrap<any>(res.body);
    expect(offer?.id).toBeTruthy();
    expect(offer?.listingId).toBe(listingId);
    expect(offer?.offererId).toBe(offerer1Id);
  });

  it('offer creation: duplicate pending offer is rejected', async () => {
    await request(app.getHttpServer())
      .post(`/exchange/${listingId}/offers`)
      .set('x-user-id', offerer1Id)
      .field('title', 'dup offer')
      .field('description', 'dup')
      .field('extraPayment', '0')
      .expect(400);
  });

  it('offer creation: negative extraPayment is rejected', async () => {
    await request(app.getHttpServer())
      .post(`/exchange/${listingId}/offers`)
      .set('x-user-id', offerer2Id)
      .field('title', 'bad money')
      .field('description', 'bad')
      .field('extraPayment', '-1')
      .field('payerRole', 'OFFERER')
      .expect(400);
  });

  it('getOfferById: only owner or offerer can access (IDOR check)', async () => {
    // create a valid offer for offerer2 via API
    const created = await request(app.getHttpServer())
      .post(`/exchange/${listingId}/offers`)
      .set('x-user-id', offerer2Id)
      .field('title', 'Offer2')
      .field('description', 'Offer2')
      .field('extraPayment', '1000')
      .field('payerRole', 'OWNER')
      .expect(201);

    const offerId = unwrap<any>(created.body)?.id;

    await request(app.getHttpServer())
      .get(`/exchange/offers/${offerId}`)
      .set('x-user-id', offerer2Id)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/exchange/offers/${offerId}`)
      .set('x-user-id', ownerId)
      .expect(200);

    const stranger = await prisma.user.create({
      data: {
        phone: `0919${Date.now().toString().slice(-7)}`,
        role: 'USER',
        isActive: true,
        isVerified: true,
        trustScore: 100,
      },
    });
    await prisma.wallet.create({
      data: { userId: stranger.id, balanceAvailable: 0, balanceBlocked: 0 },
    });

    await request(app.getHttpServer())
      .get(`/exchange/offers/${offerId}`)
      .set('x-user-id', stranger.id)
      .expect(403);
  });

  it('acceptOffer: owner accepts one -> other pending offers become WAITLISTED', async () => {
    const offers = await prisma.exchangeOffer.findMany({
      where: { listingId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, offererId: true, status: true },
    });
    const offer1 = offers.find((o) => o.offererId === offerer1Id)!;
    const offer2 = offers.find((o) => o.offererId === offerer2Id)!;

    await request(app.getHttpServer())
      .post(`/exchange/offers/${offer1.id}/accept`)
      .set('x-user-id', ownerId)
      .send({})
      .expect(201);

    const updated1 = await prisma.exchangeOffer.findUnique({
      where: { id: offer1.id },
      select: { status: true },
    });
    const updated2 = await prisma.exchangeOffer.findUnique({
      where: { id: offer2.id },
      select: { status: true },
    });
    expect(updated1?.status).toBe('ACCEPTED');
    expect(updated2?.status).toBe('WAITLISTED');
  });

  it('getOffers: owner can see all, offerer sees only their own', async () => {
    const ownerRes = await request(app.getHttpServer())
      .get(`/exchange/${listingId}/offers`)
      .set('x-user-id', ownerId)
      .expect(200);
    const ownerPayload = pickOffersPayload(ownerRes.body);
    expect(Array.isArray(ownerPayload?.items)).toBe(true);
    expect(ownerPayload.items.length).toBeGreaterThanOrEqual(2);

    const offererRes = await request(app.getHttpServer())
      .get(`/exchange/${listingId}/offers`)
      .set('x-user-id', offerer2Id)
      .expect(200);
    const offererPayload = pickOffersPayload(offererRes.body);
    expect(Array.isArray(offererPayload?.items)).toBe(true);
    // should only include offers made by offerer2
    expect(
      offererPayload.items.every((x: any) => x.offererId === offerer2Id),
    ).toBe(true);
  });
});
