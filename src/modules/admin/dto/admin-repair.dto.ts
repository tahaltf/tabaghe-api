import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class RepairSlotDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'تاریخ معتبر نیست (YYYY-MM-DD)' })
  date!: string;

  @Matches(/^\d{2}:\d{2}$/, { message: 'زمان شروع معتبر نیست (HH:mm)' })
  from!: string;

  @Matches(/^\d{2}:\d{2}$/, { message: 'زمان پایان معتبر نیست (HH:mm)' })
  to!: string;

  @IsOptional()
  allowInPersonPickup?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  pickupAddress?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{10}$/, { message: 'کد پستی باید ۱۰ رقم باشد' })
  pickupPostalCode?: string;
}

export class AdminApproveRepairDto {
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => RepairSlotDto)
  availableSlots: RepairSlotDto[] = [];

  @IsOptional()
  allowPostalDropOff?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  adminNote?: string;
}

export class AdminRejectRepairDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  rejectionReason!: string;
}

export class AdminSetResultDto {
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  inspectionResult!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  estimatedCost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  internalProfit?: number;
}

export class AdminShipBackDto {
  @IsOptional()
  @IsString()
  @IsIn(['SHIP', 'IN_PERSON'])
  returnMethod?: 'SHIP' | 'IN_PERSON';

  @IsOptional()
  @IsDateString()
  inPersonPickupTime?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @IsDateString({}, { each: true })
  inPersonPickupSlots?: string[];

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(60)
  trackingCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
