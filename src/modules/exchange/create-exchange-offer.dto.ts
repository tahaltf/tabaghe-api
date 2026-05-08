import { IsOptional, IsString, IsNumber, IsBoolean, IsIn, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';

const MAX_EXCHANGE_EXTRA_PAYMENT_TOMAN = 2_000_000_000;

export class CreateExchangeOfferDto {
    @IsString()
    title: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    images?: string[];

    @Transform(({ value }) => Number(value)) // تبدیل رشته به عدد
    @IsNumber()
    @IsOptional()
    @Min(0)
    @Max(MAX_EXCHANGE_EXTRA_PAYMENT_TOMAN)
    extraPayment?: number;

    @Transform(({ value }) => {
        if (value === true || value === 1 || value === '1') return true;
        if (value === false || value === 0 || value === '0') return false;
        if (typeof value === 'string') return value.toLowerCase() === 'true';
        return false;
    })
    @IsBoolean()
    @IsOptional()
    isPayerMe?: boolean;

    // نقش پرداخت‌کننده به‌صورت صریح (به‌جای اتکا به بولین مبهم)
    @IsOptional()
    @IsString()
    @IsIn(['OFFERER', 'OWNER'])
    payerRole?: 'OFFERER' | 'OWNER';
}