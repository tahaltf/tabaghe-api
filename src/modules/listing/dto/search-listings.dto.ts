import {
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ListingStatus, ListingType, AuctionStatus } from '@prisma/client';

export class SearchListingsDto {
    @IsOptional()
    @IsEnum(ListingType)
    type?: ListingType;

    @IsOptional()
    @IsEnum(ListingStatus)
    status?: ListingStatus;

    @IsOptional()
    @IsEnum(AuctionStatus)
    auctionStatus?: AuctionStatus;

    @IsOptional()
    @IsString()
    province?: string;

    @IsOptional()
    @IsString()
    city?: string;

    @IsOptional()
    @Type(() => Number)
    @Min(0)
    priceMin?: number;

    @IsOptional()
    @Type(() => Number)
    @Min(0)
    priceMax?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page = 1;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    limit = 20;
}
