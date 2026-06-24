import { IsString, IsOptional } from 'class-validator';

export class CreateTicketDto {
  @IsString() subject: string;
  @IsOptional() @IsString() message?: string;
  @IsOptional() @IsString() repairRequestId?: string;
}

export class SendMessageDto {
  @IsOptional() @IsString() message?: string;
}
