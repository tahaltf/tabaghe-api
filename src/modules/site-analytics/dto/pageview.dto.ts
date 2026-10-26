import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RecordPageviewDto {
  @IsString()
  @MaxLength(80)
  sessionId!: string;

  @IsString()
  @MaxLength(2000)
  path!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  referrer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  utmSource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  utmMedium?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  utmCampaign?: string;
}
