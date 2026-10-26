import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import type { OptimizeTarget } from '../../../common/upload/image-optimize.service';

export class OptimizeImagesDto {
  @IsOptional()
  @IsArray()
  @IsIn(['listings', 'banners', 'brand'], { each: true })
  targets?: OptimizeTarget[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5000)
  limit?: number;

  @IsOptional()
  @IsBoolean()
  force?: boolean;

  /** When true (default), rewrite known DB refs to .webp */
  @IsOptional()
  @IsBoolean()
  remapSettings?: boolean;
}
