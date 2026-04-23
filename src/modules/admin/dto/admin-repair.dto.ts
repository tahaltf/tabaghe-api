import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
}

export class AdminApproveRepairDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'حداقل یک زمان پیشنهادی باید تعیین شود' })
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => RepairSlotDto)
  availableSlots!: RepairSlotDto[];

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
}

export class AdminShipBackDto {
  @IsString()
  @MinLength(3)
  @MaxLength(60)
  trackingCode!: string;
}
