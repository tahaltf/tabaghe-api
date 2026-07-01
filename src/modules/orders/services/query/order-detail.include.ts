import { Prisma } from '@prisma/client';

/** Prisma include مشترک برای بارگذاری مجدد جزئیات سفارش پس از side-effectها */
export const ORDER_DETAIL_INCLUDE = {
  listing: {
    select: {
      id: true,
      title: true,
      thumbnail: true,
      type: true,
      status: true,
      condition: true,
      shippingPayer: true,
      sellerRequiresVerification: true,
    },
  },
  buyer: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      displayName: true,
      avatar: true,
      phone: true,
    },
  },
  seller: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      displayName: true,
      avatar: true,
      phone: true,
    },
  },
} satisfies Prisma.OrderInclude;
