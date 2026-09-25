import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** IPv4 or IPv4/CIDR (e.g. 1.2.3.4 or 10.0.0.0/8). */
const IP_OR_CIDR =
  /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\/(?:[0-9]|[12]\d|3[0-2]))?$/;

export class CreateGiteaIpAllowlistDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @Matches(IP_OR_CIDR, {
    message: 'آدرس باید IPv4 معتبر باشد (مثلاً 1.2.3.4 یا 1.2.3.0/24)',
  })
  ipCidr!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateGiteaIpAllowlistDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(IP_OR_CIDR, {
    message: 'آدرس باید IPv4 معتبر باشد (مثلاً 1.2.3.4 یا 1.2.3.0/24)',
  })
  ipCidr?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

export class UpdateGiteaIpAllowlistConfigDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  enforcementEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  forbiddenBrand?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  forbiddenTitle?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(800)
  forbiddenMessage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  forbiddenCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  forbiddenHint?: string;
}
