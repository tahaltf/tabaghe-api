import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class UpsertSettingDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  key!: string;

  @IsString()
  value!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;
}

export class BulkUpsertSettingsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(128)
  @ValidateNested({ each: true })
  @Type(() => UpsertSettingDto)
  items!: UpsertSettingDto[];
}
