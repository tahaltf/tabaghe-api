import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateWordPressTokenDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;
}
