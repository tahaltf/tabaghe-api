import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class AddCartItemDto {
  @IsString()
  listingId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsString()
  variationId?: string;
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

export class CartFxExpectedItemDto {
  @IsString()
  listingId!: string;

  @IsOptional()
  @IsString()
  variationId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  unitPrice!: number;
}

export class CartFxRevalidateDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartFxExpectedItemDto)
  items?: CartFxExpectedItemDto[];
}
