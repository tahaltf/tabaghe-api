import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class WordPressPingDto {
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  siteUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  pluginVersion?: string;
}
