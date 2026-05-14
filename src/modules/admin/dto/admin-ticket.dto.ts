import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { TicketStatus } from '@prisma/client';

export class AdminReplyTicketDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;
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

  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  message!: string;
}
