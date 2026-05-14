import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  IsEmail,
} from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;

  @IsOptional()
  @IsEmail({}, { message: 'فرمت ایمیل صحیح نیست' })
  email?: string;

  @IsOptional() @IsString() @MaxLength(200) bio?: string;
  @IsOptional() @IsString() avatar?: string;
  @IsOptional() @IsString() nationalCardImage?: string;

  @IsOptional() @IsBoolean() notifyEmail?: boolean;
  @IsOptional() @IsBoolean() notifySms?: boolean;
  @IsOptional() @IsBoolean() notifyPush?: boolean;
}
