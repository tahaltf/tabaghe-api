import {
    IsEnum,
    IsOptional,
    IsString,
    IsArray,
    IsInt,
    Min,
    IsBoolean,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ListingType, ItemCondition } from '@prisma/client';

class DirectDto {
    @IsInt()
    @Min(0)
    price!: number;

    @IsArray()
    @IsString({ each: true })
    shippingMethods!: string[];
}

class ExchangeDto {
    @IsString()
    desiredCategoryId!: string;

    @IsString()
    desiredTitle!: string;

    @IsOptional()
    @IsString()
    desiredDescription?: string;

    @IsInt()
    ownValue!: number;

    @IsInt()
    extraPaymentAmount!: number;

    @IsBoolean()
    acceptOtherItems!: boolean;

    @IsBoolean()
    allowDirectSale!: boolean;

    @IsOptional()
    @IsInt()
    directPrice?: number;
}

class AuctionDto {
    @IsInt()
    basePrice!: number;

    @IsInt()
    minBidIncrement!: number;

    @Type(() => Date)
    endDatetime!: Date;

    @IsBoolean()
    buyNowEnabled!: boolean;

    @IsOptional()
    @IsInt()
    buyNowPrice?: number;
}

export class CreateListingDto {
    @IsEnum(ListingType)
    type!: ListingType;

    @IsString()
    title!: string;

    @IsString()
    categoryId!: string;

    @IsEnum(ItemCondition)
    condition!: ItemCondition;

    @IsString()
    description!: string;

    @IsString()
    province!: string;

    @IsString()
    city!: string;

    @IsOptional()
    @IsString()
    thumbnail?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    gallery?: string[];

    @ValidateNested()
    @Type(() => DirectDto)
    @IsOptional()
    direct?: DirectDto;

    @ValidateNested()
    @Type(() => ExchangeDto)
    @IsOptional()
    exchange?: ExchangeDto;

    @ValidateNested()
    @Type(() => AuctionDto)
    @IsOptional()
    auction?: AuctionDto;
}
