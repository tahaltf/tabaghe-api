import {
  IsOptional,
  IsString,
  IsArray,
  IsInt,
  IsBoolean,
  ValidateNested,
  IsEnum,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
// تغییر نام از ListingCondition به ItemCondition مطابق با schema.prisma
import { ShippingPayer, ItemCondition, ListingType } from "@prisma/client";

class UpdateDirectDto {
  @IsOptional()
  @IsInt()
  price?: number;

  @IsOptional()
  @IsBoolean()
  allowExchange?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  shippingMethods?: string[];
}

class UpdateExchangeDto {
  @IsOptional()
  @IsString()
  desiredCategoryId?: string;

  @IsOptional()
  @IsString()
  desiredTitle?: string;

  @IsOptional()
  @IsString()
  desiredDescription?: string;

  @IsOptional()
  @IsInt()
  ownValue?: number;

  @IsOptional()
  @IsInt()
  extraPaymentAmount?: number;

  @IsOptional()
  @IsBoolean()
  acceptOtherItems?: boolean;

  @IsOptional()
  @IsBoolean()
  allowDirectSale?: boolean;

  @IsOptional()
  @IsInt()
  directPrice?: number;
}

class UpdateAuctionDto {
  @IsOptional()
  @IsInt()
  basePrice?: number;

  @IsOptional()
  @IsInt()
  minBidIncrement?: number;

  @IsOptional()
  @IsDateString()
  endDatetime?: string;

  @IsOptional()
  @IsBoolean()
  buyNowEnabled?: boolean;

  @IsOptional()
  @IsInt()
  buyNowPrice?: number;
}

export class UpdateListingDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsEnum(ListingType)
  type?: ListingType;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  province?: string;

  @IsOptional()
  @IsString()
  city?: string;

  // استفاده از ItemCondition برای هماهنگی با دیتابیس
  @IsOptional()
  @IsEnum(ItemCondition)
  condition?: ItemCondition;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsEnum(ShippingPayer)
  shippingPayer?: ShippingPayer;

  @IsOptional()
  @IsString()
  thumbnail?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  gallery?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateDirectDto)
  direct?: UpdateDirectDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateExchangeDto)
  exchange?: UpdateExchangeDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateAuctionDto)
  auction?: UpdateAuctionDto;
}