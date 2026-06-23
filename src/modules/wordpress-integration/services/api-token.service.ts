import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { WordPressTokenUser } from '../contracts/wordpress-auth';

const TOKEN_PREFIX_LENGTH = 8;
const TOKEN_BYTE_LENGTH = 32;

export interface GeneratedWordPressToken {
  id: string;
  name: string;
  token: string;
  tokenPrefix: string;
  createdAt: Date;
}

export interface WordPressTokenListItem {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

@Injectable()
export class WordPressApiTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(
    userId: string,
    name = 'default',
  ): Promise<GeneratedWordPressToken> {
    const raw = randomBytes(TOKEN_BYTE_LENGTH).toString('base64url');
    const token = `tbh_${raw}`;
    const tokenPrefix = token.slice(0, TOKEN_PREFIX_LENGTH);
    const tokenHash = await bcrypt.hash(token, 10);

    const row = await this.prisma.wordPressApiToken.create({
      data: {
        userId,
        name,
        tokenHash,
        tokenPrefix,
      },
    });

    return {
      id: row.id,
      name: row.name,
      token,
      tokenPrefix: row.tokenPrefix,
      createdAt: row.createdAt,
    };
  }

  listActive(userId: string): Promise<WordPressTokenListItem[]> {
    return this.prisma.wordPressApiToken.findMany({
      where: { userId, revokedAt: null },
      select: {
        id: true,
        name: true,
        tokenPrefix: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(userId: string, tokenId: string): Promise<void> {
    const row = await this.prisma.wordPressApiToken.findFirst({
      where: { id: tokenId, userId, revokedAt: null },
    });
    if (!row) {
      throw new NotFoundException('توکن یافت نشد');
    }
    await this.prisma.wordPressApiToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });
  }

  async validateBearerToken(token: string): Promise<WordPressTokenUser> {
    if (!token?.startsWith('tbh_')) {
      throw new UnauthorizedException('توکن نامعتبر است');
    }

    const tokenPrefix = token.slice(0, TOKEN_PREFIX_LENGTH);
    const candidates = await this.prisma.wordPressApiToken.findMany({
      where: { tokenPrefix, revokedAt: null },
      select: { id: true, userId: true, tokenHash: true },
    });

    for (const candidate of candidates) {
      const match = await bcrypt.compare(token, candidate.tokenHash);
      if (match) {
        await this.prisma.wordPressApiToken.update({
          where: { id: candidate.id },
          data: { lastUsedAt: new Date() },
        });
        return { id: candidate.userId, tokenId: candidate.id };
      }
    }

    throw new UnauthorizedException('توکن نامعتبر یا منقضی شده است');
  }
}
