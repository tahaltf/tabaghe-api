import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { TicketStatus } from '@prisma/client';

export class AdminReplyTicketDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}

export class AdminUpdateTicketDto {
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;
}

export class AdminCreateTicketDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  subject!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}
