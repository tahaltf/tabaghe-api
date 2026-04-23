import {
  IsEnum,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaymentMethod } from '@prisma/client';

/**
 * Body fields for submitting / editing a repair request.
 * The actual images & videos arrive as multipart files and are NOT on this DTO.
 */
export class SubmitRepairDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  deviceType!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  brand!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  model!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  description!: string;

  // JSON string of filenames to KEEP when editing (replace-only semantics).
  // When omitted we leave existing files untouched.
  @IsOptional()
  @IsString()
  keepImages?: string;

  @IsOptional()
  @IsString()
  keepVideos?: string;
}

export class SelectRepairSlotDto {
  @IsDateString()
  selectedDeliveryTime!: string;

  @IsOptional()
  @IsString()
  selectedDeliveryMethod?: 'SHIP' | 'IN_PERSON';
}

export class ShipRepairDto {
  @IsString()
  @MinLength(3)
  @MaxLength(60)
  trackingCode!: string;
}

export class ConfirmRepairResultDto {
  // Whether the user approves the estimated cost and wants the hub to proceed
  // with the actual repair. A rejected approval cancels the request.
  @IsOptional()
  @IsString()
  decision?: 'APPROVE' | 'REJECT';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RepairPayDto {
  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;
}
