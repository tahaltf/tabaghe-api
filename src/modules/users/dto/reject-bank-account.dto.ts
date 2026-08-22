import { IsString, MinLength } from 'class-validator';

export class RejectBankAccountDto {
  @IsString()
  @MinLength(3)
  reason!: string;
}
