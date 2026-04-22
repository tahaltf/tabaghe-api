import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateFaqDto {
  @IsString() @MinLength(3) @MaxLength(300) question!: string;
  @IsString() @MinLength(3) @MaxLength(4000) answer!: string;
  @IsOptional() @IsString() @MaxLength(100) category?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) order?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateFaqDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(300) question?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(4000) answer?: string;
  @IsOptional() @IsString() @MaxLength(100) category?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) order?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
