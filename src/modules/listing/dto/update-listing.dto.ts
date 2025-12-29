import {
    IsOptional,
    IsString,
    IsArray,
    IsInt,
    IsBoolean,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class UpdateDirectDto {
    @IsOptional()
    @IsInt()
    price?: number;

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
    @Type(() => Date)
    endDatetime?: Date;

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
    @IsString()
    description?: string;

    @IsOptional()
    @IsString()
    province?: string;

    @IsOptional()
    @IsString()
    city?: string;

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
