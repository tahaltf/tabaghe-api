import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class PruneDockerImagesDto {
  @IsString()
  confirmPhrase!: string;
}

export class PruneDockerBuildCacheDto {
  @IsString()
  confirmPhrase!: string;
}

export const BACKUP_PRUNE_MODES = [
  'retention',
  'keepLatest',
  'allExceptLatest',
  'all',
] as const;
export type BackupPruneMode = (typeof BACKUP_PRUNE_MODES)[number];

export class PruneBackupFilesDto {
  @IsIn(BACKUP_PRUNE_MODES)
  mode!: BackupPruneMode;

  /** برای keepLatest — حداقل ۱ فایل نگه داشته می‌شود */
  @IsOptional()
  @IsInt()
  @Min(1)
  keepLatest?: number;
}
