import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export const BACKUP_SCHEDULE_MODES = ['manual', 'interval'] as const;
export type BackupScheduleMode = (typeof BACKUP_SCHEDULE_MODES)[number];

export const BACKUP_INTERVAL_HOURS = [1, 3, 6, 12, 24, 168] as const;

export class UpdateBackupConfigDto {
  @IsBoolean()
  enabled!: boolean;

  @IsIn(BACKUP_SCHEDULE_MODES)
  scheduleMode!: BackupScheduleMode;

  @IsInt()
  @Min(1)
  @Max(168)
  intervalHours!: number;

  @IsInt()
  @Min(1)
  @Max(90)
  retentionDays!: number;

  @IsOptional()
  @IsString()
  backupDir?: string;

  /** اگر true و BACKUP_SCRIPT_PATH روی سرور ست شده باشد، از اسکریپت هاست استفاده می‌شود */
  @IsOptional()
  @IsBoolean()
  preferHostScript?: boolean;
}
