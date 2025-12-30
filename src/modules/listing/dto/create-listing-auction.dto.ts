import {
    IsBoolean,
    IsDateString,
    IsNumber,
    IsOptional,
    Min,
} from 'class-validator';

export class CreateListingAuctionDto {
    @IsNumber()
    @Min(1)
    basePrice: number;

    @IsNumber()
    @Min(1)
    minBidIncrement: number;

    @IsDateString()
    endDatetime: string;

    @IsOptional()
    @IsBoolean()
    buyNowEnabled?: boolean;

    @IsOptional()
    @IsNumber()
    @Min(1)
    buyNowPrice?: number;
}
