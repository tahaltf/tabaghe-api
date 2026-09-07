import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class AddCartItemDto {
  @IsString()
  listingId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;
}

export class UpdateCartItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CartCheckoutPreviewDto {
  @IsOptional()
  @IsString()
  couponCode?: string;

  @IsOptional()
  @IsBoolean()
  requiresVerification?: boolean;
}

export class CartCheckoutDto extends CartCheckoutPreviewDto {
  @IsString()
  addressId!: string;

  @IsString()
  paymentMethod!: 'GATEWAY' | 'WALLET';

  /** نوع درگاه فعال وقتی چند درگاه فعال باشد */
  @IsOptional()
  @IsString()
  gateway?: string;
}
