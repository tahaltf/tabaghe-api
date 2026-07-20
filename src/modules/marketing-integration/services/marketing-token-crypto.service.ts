import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * AES-256-GCM encryption for OAuth access tokens at rest.
 * Requires MARKETING_TOKEN_ENC_KEY as 64 hex chars (32 bytes).
 */
@Injectable()
export class MarketingTokenCryptoService implements OnModuleInit {
  private readonly logger = new Logger(MarketingTokenCryptoService.name);
  private key: Buffer | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const raw = this.config.get<string>('MARKETING_TOKEN_ENC_KEY')?.trim();
    if (!raw) {
      this.logger.warn(
        'MARKETING_TOKEN_ENC_KEY is not set — Instagram token storage will fail until configured',
      );
      return;
    }
    if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
      this.logger.error(
        'MARKETING_TOKEN_ENC_KEY must be 64 hex characters (32 bytes)',
      );
      return;
    }
    this.key = Buffer.from(raw, 'hex');
  }

  isReady(): boolean {
    return this.key !== null;
  }

  encrypt(plaintext: string): string {
    if (!this.key) {
      throw new Error('MARKETING_TOKEN_ENC_KEY is not configured');
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  decrypt(payload: string): string {
    if (!this.key) {
      throw new Error('MARKETING_TOKEN_ENC_KEY is not configured');
    }
    const [ivHex, tagHex, dataHex] = payload.split(':');
    if (!ivHex || !tagHex || !dataHex) {
      throw new Error('Invalid encrypted token payload');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  }
}
