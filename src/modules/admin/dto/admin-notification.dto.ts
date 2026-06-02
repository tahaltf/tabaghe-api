import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class SmsTemplateParameterDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  value!: string;
}

class SmsTemplateConfigDto {
  @Type(() => Number)
  @IsNumber()
  templateId!: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SmsTemplateParameterDto)
  parameters?: SmsTemplateParameterDto[];
}

export class BroadcastNotificationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  title!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  message!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  userIds?: string[];

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  alsoSendSms?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => SmsTemplateConfigDto)
  smsTemplateConfig?: SmsTemplateConfigDto;

  /** مسیر داخلی (مثلاً /listing/abc) یا لینک خارجی https — اختیاری */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(/^(\/[^\s]*|https?:\/\/[^\s]+)$/i, {
    message: 'linkUrl must be an internal path (/...) or http(s) URL',
  })
  linkUrl?: string;
}
