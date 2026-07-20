import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateAdminRoleDto {
  @IsString()
  @MinLength(2, { message: 'نام نقش حداقل ۲ کاراکتر باشد' })
  @Length(2, 80)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(2, 80)
  slug?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionKeys!: string[];
}

export class UpdateAdminRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @Length(2, 80)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(2, 80)
  slug?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionKeys?: string[];
}

export class SetUserAdminRoleDto {
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  adminRoleId!: string | null;
}
