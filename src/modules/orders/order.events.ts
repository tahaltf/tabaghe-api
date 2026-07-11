export const OrderEvents = {
  COMPLETED: 'order.completed',
} as const;

export type OrderCompletedPayload = {
  orderId: string;
  buyerId: string;
  sellerId: string;
  listingId: string;
};
