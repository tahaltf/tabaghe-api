import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  SYSTEM_JOB_SETTING_GROUPS,
  SYSTEM_JOB_SETTING_KEYS,
  SYSTEM_JOB_SETTINGS_REGISTRY,
  getSystemJobSettingDef,
} from '../config/system-job-settings.registry';
import { SYSTEM_JOBS_REGISTRY } from '../config/system-jobs.registry';
import type { UpdateSystemJobSettingsDto } from '../dto/admin-system-jobs.dto';
import { AdminBackupService } from './admin-backup.service';

export interface SystemJobSettingValueDto {
  key: string;
  label: string;
  description: string;
  type: string;
  unit: string;
  defaultValue: string;
  value: string;
  effectiveValue: string;
  min?: number;
  max?: number;
}

export interface SystemJobSettingsGroupDto {
  id: string;
  label: string;
  description: string;
  settings: SystemJobSettingValueDto[];
}

export interface SystemJobsOverviewDto {
  jobs: typeof SYSTEM_JOBS_REGISTRY;
  settingGroups: SystemJobSettingsGroupDto[];
  backup: {
    adminPath: string;
    enabled: boolean;
    scheduleMode: string;
    intervalHours: number;
    nextRunAt: string | null;
    lastRunAt: string | null;
    lastStatus: string | null;
  };
  notes: string[];
}

@Injectable()
export class AdminSystemJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly backup: AdminBackupService,
  ) {}

  async getOverview(): Promise<SystemJobsOverviewDto> {
    const keys = SYSTEM_JOB_SETTINGS_REGISTRY.map((s) => s.key);
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: keys } },
      select: { key: true, value: true },
    });
    const valueByKey = new Map(rows.map((r) => [r.key, r.value]));

    const settingGroups: SystemJobSettingsGroupDto[] =
      SYSTEM_JOB_SETTING_GROUPS.map((group) => ({
        id: group.id,
        label: group.label,
        description: group.description,
        settings: SYSTEM_JOB_SETTINGS_REGISTRY.filter(
          (s) => s.groupId === group.id,
        ).map((def) => {
          const stored = valueByKey.get(def.key);
          const effective = this.resolveEffectiveValue(def.key, stored, def);
          return {
            key: def.key,
            label: def.label,
            description: def.description,
            type: def.type,
            unit: def.unit,
            defaultValue: def.defaultValue,
            value: stored ?? '',
            effectiveValue: effective,
            min: def.min,
            max: def.max,
          };
        }),
      }));

    const backupCfg = await this.backup.getConfig();

    return {
      jobs: SYSTEM_JOBS_REGISTRY,
      settingGroups,
      backup: {
        adminPath: '/admin/backup',
        enabled: backupCfg.enabled,
        scheduleMode: backupCfg.scheduleMode,
        intervalHours: backupCfg.intervalHours,
        nextRunAt: backupCfg.nextRunAt,
        lastRunAt: backupCfg.lastRunAt,
        lastStatus: backupCfg.lastStatus,
      },
      notes: [
        'تایید خودکار آگهی در کرون وجود ندارد؛ آگهی‌ها از پنل ادمین تایید می‌شوند.',
        'تغییر مقدار تنظیمات از اجرای بعدی جاب‌ها اعمال می‌شود (خواندن در زمان اجرا).',
        'بک‌اپ دیتابیس از صفحه «بک‌اپ» مدیریت می‌شود.',
      ],
    };
  }

  async updateSettings(dto: UpdateSystemJobSettingsDto) {
    for (const item of dto.items) {
      if (!SYSTEM_JOB_SETTING_KEYS.has(item.key)) {
        throw new BadRequestException(`تنظیم مجاز نیست: ${item.key}`);
      }
      const def = getSystemJobSettingDef(item.key);
      if (!def) continue;
      this.validateSettingValue(def, item.value);
    }

    await this.prisma.$transaction(
      dto.items.map((item) => {
        const def = getSystemJobSettingDef(item.key)!;
        return this.prisma.systemSetting.upsert({
          where: { key: item.key },
          create: {
            key: item.key,
            value: item.value.trim(),
            description: def.description,
          },
          update: {
            value: item.value.trim(),
            description: def.description,
          },
        });
      }),
    );

    return this.getOverview();
  }

  private resolveEffectiveValue(
    key: string,
    stored: string | undefined,
    def: { defaultValue: string; type: string },
  ): string {
    const trimmed = stored?.trim();
    if (trimmed) {
      if (def.type === 'number' && Number(trimmed) > 0) return trimmed;
      if (def.type !== 'number') return trimmed;
    }
    return def.defaultValue;
  }

  private validateSettingValue(
    def: {
      type: string;
      min?: number;
      max?: number;
      key: string;
    },
    raw: string,
  ): void {
    const value = raw?.trim();
    if (!value) {
      throw new BadRequestException(`مقدار ${def.key} خالی است`);
    }
    if (def.type === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        throw new BadRequestException(`مقدار ${def.key} باید عدد باشد`);
      }
      if (def.min != null && n < def.min) {
        throw new BadRequestException(
          `مقدار ${def.key} نباید کمتر از ${def.min} باشد`,
        );
      }
      if (def.max != null && n > def.max) {
        throw new BadRequestException(
          `مقدار ${def.key} نباید بیشتر از ${def.max} باشد`,
        );
      }
    }
  }
}
