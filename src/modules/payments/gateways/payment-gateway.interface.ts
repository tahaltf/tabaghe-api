import { PaymentGatewayName } from '../../../shared/settings/app-settings.service';

export type GatewayRequestPayload = {
  amount: number;
  callbackUrl: string;
  orderId: string;
  description: string;
  mobile?: string;
};

export type GatewayRequestResult = {
  paymentUrl: string;
  authority: string;
  raw?: unknown;
};

export type GatewayVerifyPayload = {
  authority: string;
  expectedAmount: number;
};

export type GatewayVerifyResult = {
  success: boolean;
  refId?: string;
  message?: string;
  raw?: unknown;
};

export interface PaymentGateway {
  readonly name: PaymentGatewayName;
  requestPayment(payload: GatewayRequestPayload): Promise<GatewayRequestResult>;
  verifyPayment(payload: GatewayVerifyPayload): Promise<GatewayVerifyResult>;
}
