import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class SystemJobSettingItemDto {
  @IsString()
  @MaxLength(120)
  key!: string;

  @IsString()
  @MaxLength(500)
  value!: string;
}

export class UpdateSystemJobSettingsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SystemJobSettingItemDto)
  items!: SystemJobSettingItemDto[];
}
