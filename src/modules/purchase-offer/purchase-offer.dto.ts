import { IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePurchaseOfferDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsString()
  @IsNotEmpty({ message: 'استان الزامی است' })
  @MaxLength(100)
  province!: string;

  @IsString()
  @IsNotEmpty({ message: 'شهر الزامی است' })
  @MaxLength(100)
  city!: string;
}

export class RejectPurchaseOfferDto {
  @IsString()
  @MaxLength(2000)
  reason!: string;
}
