import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { WORDPRESS_SYNC_INTERVAL_HOURS } from '../../../common/utils/min-stock-threshold.util';

export class AdminUpsertWordPressSyncPolicyDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([...WORDPRESS_SYNC_INTERVAL_HOURS], {
    message: 'بازه همگام‌سازی باید ۰، ۶، ۱۲ یا ۲۴ ساعت باشد',
  })
  syncIntervalHours?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  minStockForAvailable?: number;
}
