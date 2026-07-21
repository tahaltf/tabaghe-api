import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  defaultPanelAccessMap,
  isUserPanelAccessKey,
  USER_PANEL_ACCESS_KEYS,
  UserPanelAccessKey,
  UserPanelAccessMap,
} from './config/user-panel-access.registry';

type PanelAccessCarrier = {
  panelAccess?: Prisma.JsonValue | null;
};

/**
 * Stores the full resolved boolean map in DB for clarity (every known key present).
 * Missing keys and null still resolve to enabled (true) when reading legacy rows.
 */
@Injectable()
export class UserPanelAccessService {
  constructor(private readonly prisma: PrismaService) {}

  resolveMap(raw: Prisma.JsonValue | null | undefined): UserPanelAccessMap {
    const resolved = defaultPanelAccessMap();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return resolved;
    }

    const stored = raw as Record<string, unknown>;
    for (const key of USER_PANEL_ACCESS_KEYS) {
      const value = stored[key];
      if (value === false) resolved[key] = false;
      else if (value === true) resolved[key] = true;
    }
    return resolved;
  }

  isAllowed(
    rawOrUser: Prisma.JsonValue | null | undefined | PanelAccessCarrier,
    key: UserPanelAccessKey,
  ): boolean {
    const raw =
      rawOrUser &&
      typeof rawOrUser === 'object' &&
      !Array.isArray(rawOrUser) &&
      'panelAccess' in rawOrUser
        ? rawOrUser.panelAccess
        : rawOrUser;
    return this.resolveMap(raw)[key];
  }

  validatePatch(body: Record<string, unknown>): Partial<UserPanelAccessMap> {
    const patch: Partial<UserPanelAccessMap> = {};
    for (const [key, value] of Object.entries(body)) {
      if (!isUserPanelAccessKey(key)) {
        throw new BadRequestException(`کلید دسترسی نامعتبر: ${key}`);
      }
      if (typeof value !== 'boolean') {
        throw new BadRequestException(
          `مقدار دسترسی «${key}» باید true یا false باشد`,
        );
      }
      patch[key] = value;
    }
    return patch;
  }

  async getResolvedForUser(userId: string): Promise<UserPanelAccessMap> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { panelAccess: true },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    return this.resolveMap(user.panelAccess);
  }

  async updateForUser(
    userId: string,
    patch: Record<string, unknown>,
  ): Promise<UserPanelAccessMap> {
    const validatedPatch = this.validatePatch(patch);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { panelAccess: true },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');

    const next = {
      ...this.resolveMap(user.panelAccess),
      ...validatedPatch,
    };

    await this.prisma.user.update({
      where: { id: userId },
      data: { panelAccess: next as Prisma.InputJsonValue },
    });

    return next;
  }
}
