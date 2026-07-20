import {
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { MarketingMediaType } from '@prisma/client';
import { createReadStream, existsSync, unlinkSync } from 'fs';
import { basename, join } from 'path';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ServerSecretConfigService } from '../../../shared/settings/server-secret-config.service';

@Injectable()
export class MarketingMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: ServerSecretConfigService,
  ) {}

  private publicBase(): string {
    return (
      this.secrets.get('API_PUBLIC_URL') ||
      this.secrets.get('API_URL') ||
      'http://localhost:3000'
    ).replace(/\/$/, '');
  }

  list(accountId?: string) {
    return this.prisma.marketingMediaAsset.findMany({
      where: accountId ? { accountId } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        account: {
          select: { id: true, username: true, platform: true },
        },
      },
    });
  }

  async getOrThrow(id: string) {
    const asset = await this.prisma.marketingMediaAsset.findUnique({
      where: { id },
    });
    if (!asset) throw new NotFoundException('رسانه یافت نشد');
    return asset;
  }

  async createFromUpload(params: {
    file: Express.Multer.File;
    createdById: string;
    accountId?: string;
    caption?: string;
    altText?: string;
  }) {
    const isVideo = params.file.mimetype.startsWith('video/');
    const publicUrl = `${this.publicBase()}/uploads/marketing/${params.file.filename}`;

    return this.prisma.marketingMediaAsset.create({
      data: {
        accountId: params.accountId || null,
        fileName: params.file.originalname || params.file.filename,
        mimeType: params.file.mimetype,
        localPath: params.file.path.replace(/\\/g, '/'),
        publicUrl,
        mediaType: isVideo
          ? MarketingMediaType.VIDEO
          : MarketingMediaType.IMAGE,
        caption: params.caption || null,
        altText: params.altText || null,
        fileSize: params.file.size,
        createdById: params.createdById,
      },
    });
  }

  async updateMeta(
    id: string,
    data: { caption?: string; altText?: string; accountId?: string | null },
  ) {
    await this.getOrThrow(id);
    return this.prisma.marketingMediaAsset.update({
      where: { id },
      data: {
        ...(data.caption !== undefined ? { caption: data.caption } : {}),
        ...(data.altText !== undefined ? { altText: data.altText } : {}),
        ...(data.accountId !== undefined ? { accountId: data.accountId } : {}),
      },
    });
  }

  async remove(id: string) {
    const asset = await this.getOrThrow(id);
    const abs = join(process.cwd(), asset.localPath.replace(/^\.\//, ''));
    if (existsSync(abs)) {
      try {
        unlinkSync(abs);
      } catch {
        /* ignore */
      }
    }
    await this.prisma.marketingMediaAsset.delete({ where: { id } });
    return { ok: true };
  }

  async download(id: string): Promise<{ file: StreamableFile; fileName: string }> {
    const asset = await this.getOrThrow(id);
    const abs = join(process.cwd(), asset.localPath.replace(/^\.\//, ''));
    if (!existsSync(abs)) {
      throw new NotFoundException('فایل روی دیسک یافت نشد');
    }
    return {
      file: new StreamableFile(createReadStream(abs), {
        type: asset.mimeType,
        disposition: `attachment; filename="${basename(asset.fileName)}"`,
      }),
      fileName: asset.fileName,
    };
  }
}
