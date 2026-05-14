import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { LocationType } from '@prisma/client';

export class CreateLocationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsEnum(LocationType)
  type!: LocationType;

  @IsOptional()
  @IsString()
  parentId?: string | null;
}

export class UpdateLocationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsEnum(LocationType)
  type?: LocationType;

  @IsOptional()
  @IsString()
  parentId?: string | null;
}
