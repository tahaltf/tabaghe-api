import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AdminSmsBroadcastDto {
  @ValidateIf((o) => !o.templateName)
  @IsInt()
  templateId?: number;

  @ValidateIf((o) => !o.templateId)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  templateName?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  parameterName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  parameterValue!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  userIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  phones?: string[];

  /** عنوان اطلاعیه درون‌برنامه‌ای (پیش‌فرض: اطلاعیه طبقه) */
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  siteTitle?: string;

  /** در صورت true (پیش‌فرض)، علاوه بر SMS در صفحه اطلاعیه کاربر هم ثبت می‌شود */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  alsoCreateSiteNotification?: boolean;
}
