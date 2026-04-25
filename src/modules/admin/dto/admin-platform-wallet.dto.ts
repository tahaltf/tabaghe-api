import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export enum PlatformCreditSource {
  PROFIT = 'PROFIT',
  EXTERNAL = 'EXTERNAL',
}

export class PlatformProfitWithdrawDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  amount!: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class PlatformCreditUserDto {
  @IsString()
  userId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  amount!: number;

  @IsEnum(PlatformCreditSource)
  source!: PlatformCreditSource;

  @IsOptional()
  @IsString()
  note?: string;
}

