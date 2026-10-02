import { IsBoolean } from 'class-validator';

export class AdminSetUserPayoutOnShipmentDto {
  @IsBoolean({ message: 'مقدار تسویه بعد از ارسال باید true/false باشد' })
  payoutOnShipment!: boolean;
}
