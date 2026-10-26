import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Login username: letter start, then alnum / . _ - */
const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9._-]{2,39}$/;

export class CreateCrawlerPanelUserDto {
  @IsString()
  @Matches(USERNAME_RE, {
    message:
      'نام کاربری باید با حرف شروع شود و ۳ تا ۴۰ کاراکتر (حرف، عدد، . _ -) باشد',
  })
  username!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  displayName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  ipAllowlistEntryId?: string | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateCrawlerPanelUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  ipAllowlistEntryId?: string | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

export class CrawlerPanelLoginDto {
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  username!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

export class CreateCrawlerAccessDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @Matches(
    /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\/(?:[0-9]|[12]\d|3[0-2]))?$/,
    {
      message: 'آدرس باید IPv4 معتبر باشد (مثلاً 1.2.3.4 یا 1.2.3.0/24)',
    },
  )
  ipCidr!: string;

  @IsString()
  @Matches(USERNAME_RE, {
    message:
      'نام کاربری باید با حرف شروع شود و ۳ تا ۴۰ کاراکتر (حرف، عدد، . _ -) باشد',
  })
  username!: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
