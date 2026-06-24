import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  buildAcceptAttribute,
  buildTicketAttachmentFromFile,
  formatTicketAttachmentLabels,
  parseTicketAttachmentMaxSizeBytes,
  parseTicketAttachmentMimeTypes,
  TICKET_ATTACHMENT_SETTING_KEYS,
  TicketMessageAttachment,
} from '../../common/upload/ticket-attachment-settings.util';

@Injectable()
export class TicketAttachmentSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublicConfig() {
    const settings = await this.loadSettings();
    return {
      allowedMimeTypes: settings.allowedMimeTypes,
      maxSizeMb: settings.maxSizeMb,
      accept: settings.accept,
      labels: settings.labels,
    };
  }

  async validateAndBuildAttachment(
    file?: Express.Multer.File,
  ): Promise<TicketMessageAttachment[] | undefined> {
    if (!file) return undefined;

    const settings = await this.loadSettings();
    const mime = String(file.mimetype ?? '').toLowerCase();
    if (!settings.allowedMimeTypes.includes(mime)) {
      await this.removeUploadedFile(file.filename);
      throw new BadRequestException(
        `این نوع فایل مجاز نیست. فرمت‌های مجاز: ${settings.labels}`,
      );
    }

    if (file.size > settings.maxSizeBytes) {
      await this.removeUploadedFile(file.filename);
      throw new BadRequestException(
        `حجم فایل باید حداکثر ${settings.maxSizeMb} مگابایت باشد.`,
      );
    }

    return [buildTicketAttachmentFromFile(file)];
  }

  private async loadSettings() {
    const rows = await this.prisma.systemSetting.findMany({
      where: {
        key: {
          in: [
            TICKET_ATTACHMENT_SETTING_KEYS.MIME_TYPES,
            TICKET_ATTACHMENT_SETTING_KEYS.MAX_SIZE_MB,
          ],
        },
      },
      select: { key: true, value: true },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const allowedMimeTypes = parseTicketAttachmentMimeTypes(
      map.get(TICKET_ATTACHMENT_SETTING_KEYS.MIME_TYPES),
    );
    const maxSizeMb = Math.round(
      parseTicketAttachmentMaxSizeBytes(
        map.get(TICKET_ATTACHMENT_SETTING_KEYS.MAX_SIZE_MB),
      ) /
        (1024 * 1024),
    );
    const maxSizeBytes = maxSizeMb * 1024 * 1024;
    return {
      allowedMimeTypes,
      maxSizeMb,
      maxSizeBytes,
      accept: buildAcceptAttribute(allowedMimeTypes),
      labels: formatTicketAttachmentLabels(allowedMimeTypes),
    };
  }

  private async removeUploadedFile(filename: string): Promise<void> {
    try {
      await unlink(join(process.cwd(), 'uploads', 'tickets', filename));
    } catch {
      // ignore missing file
    }
  }
}
