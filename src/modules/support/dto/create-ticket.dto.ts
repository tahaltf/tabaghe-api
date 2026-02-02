import { IsString, IsOptional, IsEnum } from 'class-validator';

export class CreateTicketDto {
  @IsString() subject: string;
  @IsString() message: string;
  @IsOptional() @IsString() repairRequestId?: string;
}

export class SendMessageDto {
  @IsString() message: string;
}