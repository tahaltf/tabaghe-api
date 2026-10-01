import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { timingSafeEqual } from 'crypto';
import { ServerSecretConfigService } from '../../../shared/settings/server-secret-config.service';

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

@Injectable()
export class FxIngestGuard implements CanActivate {
  constructor(private readonly secrets: ServerSecretConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.secrets.get('FX_INGEST_SECRET')?.trim();
    if (!expected) {
      throw new UnauthorizedException(
        'کلید FX_INGEST_SECRET در سرور تنظیم نشده است',
      );
    }

    const req = context.switchToHttp().getRequest<Request>();
    const headerKey =
      (req.headers['x-fx-ingest-key'] as string | undefined)?.trim() || '';
    const auth = (req.headers.authorization || '').trim();
    const bearer = auth.toLowerCase().startsWith('bearer ')
      ? auth.slice(7).trim()
      : '';

    const provided = headerKey || bearer;
    if (!provided || !safeEqual(provided, expected)) {
      throw new UnauthorizedException('کلید ingest نرخ ارز نامعتبر است');
    }
    return true;
  }
}
