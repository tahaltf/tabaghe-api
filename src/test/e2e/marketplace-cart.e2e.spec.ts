import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { IsVerifiedGuard } from '../../modules/auth/guards/is-verified.guard';
import { ThrottlerGuard } from '@nestjs/throttler';
import { CheckoutSessionStatus } from '@prisma/client';

const runE2e = process.env.RUN_MARKETPLACE_E2E === '1';

(runE2e ? describe : describe.skip)('Marketplace Cart E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let buyerId: string;
  let sellerId: string;
  let otherSellerId: string;
  let listingIds: string[] = [];
  let otherListingId: string;
  let addressId: string;
  let couponCode: string;

  const unwrap = <T>(body: unknown): T => {
    let cur: unknown = body;
    for (let i = 0; i < 3; i++) {
      if (cur && typeof cur === 'object' && 'data' in (cur as Record<string, unknown>)) {
        cur = (cur as { data: unknown }).data;
      } else break;
    }
    return cur as T;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: { switchToHttp: () => { getRequest: () => Record<string, unknown> } }) => {
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

    const suffix = Date.now().toString().slice(-7);
    const buyer = await prisma.user.create({
      data: {
        phone: `0913${suffix}1`,
        role: 'USER',
        isActive: true,
        isVerified: true,
        trustScore: 100,
      },
    });
    const seller = await prisma.user.create({
      data: {
        phone: `0913${suffix}2`,
        role: 'USER',
        isActive: true,
        isVerified: true,
        trustScore: 100,
      },
    });
    const otherSeller = await prisma.user.create({
      data: {
        phone: `0913${suffix}3`,
        role: 'USER',
        isActive: true,
        isVerified: true,
        trustScore: 100,
      },
    });
    buyerId = buyer.id;
    sellerId = seller.id;
    otherSellerId = otherSeller.id;

    const category = await prisma.category.upsert({
      where: { slug: 'test-marketplace-cart' },
      create: { slug: 'test-marketplace-cart', title: 'Test Cart Category' },
      update: { title: 'Test Cart Category' },
    });
    const province = await prisma.location.create({
      data: {
        name: `Cart-prov-${suffix}`,
        type: 'PROVINCE',
        slug: `e2e-cart-prov-${suffix}`,
      },
    });
    const city = await prisma.location.create({
      data: {
        name: `Cart-city-${suffix}`,
        type: 'CITY',
        parentId: province.id,
        slug: `e2e-cart-city-${suffix}`,
      },
    });

    const prices = [100_000, 200_000, 300_000];
    for (let i = 0; i < prices.length; i++) {
      const listing = await prisma.listing.create({
        data: {
          authorId: sellerId,
          type: 'DIRECT',
          status: 'APPROVED',
          title: `Cart item ${i + 1}`,
          categoryId: category.id,
          condition: 'USED',
          description: 'e2e cart test',
          provinceId: province.id,
          cityId: city.id,
          gallery: [],
          thumbnail: null,
          shippingPayer: 'SELLER_PREPAID',
          stockQuantity: 10,
          singleItemSale: false,
          direct: {
            create: { price: prices[i] },
          },
        },
      });
      listingIds.push(listing.id);
    }

    const otherListing = await prisma.listing.create({
      data: {
        authorId: otherSellerId,
        type: 'DIRECT',
        status: 'APPROVED',
        title: 'Other seller item',
        categoryId: category.id,
        condition: 'USED',
        description: 'e2e',
        provinceId: province.id,
        cityId: city.id,
        gallery: [],
        thumbnail: null,
        shippingPayer: 'SELLER_PREPAID',
        stockQuantity: 5,
        direct: { create: { price: 50_000 } },
      },
    });
    otherListingId = otherListing.id;

    const address = await prisma.address.create({
      data: {
        userId: buyerId,
        title: 'خانه',
        province: 'تهران',
        city: 'تهران',
        fullAddress: 'خیابان تست',
        postalCode: '1234567890',
        phone: buyer.phone,
      },
    });
    addressId = address.id;

    couponCode = `E2E${suffix}`;
    await prisma.coupon.create({
      data: {
        code: couponCode,
        discountType: 'PERCENT',
        discountValue: 10,
        scopeMode: 'ALL',
        allowOnSaleItems: true,
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects adding item from a different seller', async () => {
    await request(app.getHttpServer())
      .post('/cart/items')
      .set('x-user-id', buyerId)
      .send({ listingId: listingIds[0], quantity: 1 })
      .expect(201);

    await request(app.getHttpServer())
      .post('/cart/items')
      .set('x-user-id', buyerId)
      .send({ listingId: otherListingId, quantity: 1 })
      .expect(400);

    await request(app.getHttpServer())
      .delete('/cart')
      .set('x-user-id', buyerId)
      .expect(200);
  });

  it('previews cart checkout with coupon discount', async () => {
    for (const listingId of listingIds) {
      await request(app.getHttpServer())
        .post('/cart/items')
        .set('x-user-id', buyerId)
        .send({ listingId, quantity: 1 })
        .expect(201);
    }

    const res = await request(app.getHttpServer())
      .post('/cart/checkout-preview')
      .set('x-user-id', buyerId)
      .send({ couponCode, requiresVerification: false })
      .expect(201);

    const preview = unwrap<{
      subtotal: number;
      discountAmount: number;
      totalPayable: number;
      items: unknown[];
    }>(res.body);

    expect(preview.items.length).toBe(3);
    expect(preview.subtotal).toBe(600_000);
    expect(preview.discountAmount).toBe(60_000);
    expect(preview.totalPayable).toBe(540_000);
  });

  it('checkout creates session, links orders, clears cart, increments coupon', async () => {
    const res = await request(app.getHttpServer())
      .post('/cart/checkout')
      .set('x-user-id', buyerId)
      .send({
        addressId,
        paymentMethod: 'WALLET',
        couponCode,
        requiresVerification: false,
      })
      .expect(201);

    const checkout = unwrap<{
      sessionId: string;
      orderIds: string[];
      totalAmount: number;
      discountAmount: number;
    }>(res.body);

    expect(checkout.orderIds.length).toBe(3);
    expect(checkout.totalAmount).toBe(540_000);
    expect(checkout.discountAmount).toBe(60_000);

    const session = await prisma.checkoutSession.findUnique({
      where: { id: checkout.sessionId },
      include: { orders: true, redemptions: true },
    });
    expect(session?.status).toBe(CheckoutSessionStatus.PENDING);
    expect(session?.orders.length).toBe(3);
    expect(session?.redemptions.length).toBe(1);

    const cartRes = await request(app.getHttpServer())
      .get('/cart')
      .set('x-user-id', buyerId)
      .expect(200);
    const cart = unwrap<{ itemCount: number; items: unknown[] }>(cartRes.body);
    expect(cart.itemCount).toBe(0);
    expect(cart.items.length).toBe(0);

    const coupon = await prisma.coupon.findUnique({ where: { code: couponCode } });
    expect(coupon?.usedCount).toBe(1);
  });
});
