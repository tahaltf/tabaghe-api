import { IsArray, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateExchangeOfferDto {
    @IsString()
    title: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsArray()
    images: string[];

    @IsOptional()
    @IsNumber()
    extraPayment?: number;
}
