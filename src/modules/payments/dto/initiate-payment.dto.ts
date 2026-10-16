import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class InitiateGatewayOnlyDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  gateway?: string;
}

export class InitiateWalletTopupDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1000)
  @Max(500_000_000)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  gateway?: string;
}
