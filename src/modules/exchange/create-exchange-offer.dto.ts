import { IsOptional, IsString, IsNumber, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateExchangeOfferDto {
    @IsString()
    title: string;

    @IsOptional()
    @IsString()
    description?: string;

    // 👈 فیلد images رو از DTO ولیدیشن حذف کن یا IsOptional بذار
    // چون عکس‌ها در پارامتر @UploadedFiles() هندل می‌شن نه در بدنه DTO
    @IsOptional()
    images?: any;

    @Transform(({ value }) => Number(value)) // تبدیل رشته به عدد
    @IsNumber()
    @IsOptional()
    extraPayment?: number;

    @Transform(({ value }) => value === 'true') // تبدیل رشته به بولیین
    @IsBoolean()
    @IsOptional()
    isPayerMe?: boolean;
}