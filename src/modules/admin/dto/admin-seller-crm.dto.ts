import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  SellerLeadActivityType,
  SellerLeadLostReason,
  SellerLeadSource,
  SellerLeadStage,
} from '@prisma/client';

export class AdminSellerLeadListQueryDto {
  @IsOptional()
  @IsEnum(SellerLeadStage)
  stage?: SellerLeadStage;

  @IsOptional()
  @IsEnum(SellerLeadSource)
  source?: SellerLeadSource;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  /** true = پیگیری امروز یا عقب‌افتاده */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return undefined;
  })
  @IsIn([true, false])
  followUpDue?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}

export class AdminCreateSellerLeadDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  shopName?: string;

  @IsString()
  @MinLength(10)
  @MaxLength(20)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  province?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  categoryHint?: string;

  @IsOptional()
  @IsEnum(SellerLeadSource)
  source?: SellerLeadSource;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsDateString()
  nextFollowUpAt?: string;
}

export class AdminUpdateSellerLeadDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  shopName?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  province?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  categoryHint?: string | null;

  @IsOptional()
  @IsEnum(SellerLeadSource)
  source?: SellerLeadSource;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @IsOptional()
  @IsDateString()
  nextFollowUpAt?: string | null;
}

export class AdminChangeSellerLeadStageDto {
  @IsEnum(SellerLeadStage)
  stage!: SellerLeadStage;

  @IsOptional()
  @IsEnum(SellerLeadLostReason)
  lostReason?: SellerLeadLostReason;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class AdminCreateSellerLeadActivityDto {
  @IsEnum(SellerLeadActivityType)
  type!: SellerLeadActivityType;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  body?: string;

  @IsOptional()
  @IsDateString()
  nextFollowUpAt?: string | null;
}

export class AdminSellerLeadSmsDto {
  @IsString()
  @MinLength(2)
  @MaxLength(900)
  messageText!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  lineNumber?: number;
}

export class AdminConvertSellerLeadDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class AdminImportSellerLeadsDto {
  /** CSV یا خطوط: نام,موبایل,فروشگاه,شهر,منبع */
  @IsString()
  @MinLength(5)
  text!: string;

  @IsOptional()
  @IsEnum(SellerLeadSource)
  defaultSource?: SellerLeadSource;
}

/** Body برای POST /integrations/seller-crm/divar-leads (کرالر) */
export class AdminIngestDivarSellerLeadDto {
  @IsString()
  @MinLength(10)
  @MaxLength(20)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  shopName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  categoryHint?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  adUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  adId?: string;
}
