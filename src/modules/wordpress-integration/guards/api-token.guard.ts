import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { WordPressApiTokenService } from '../services/api-token.service';
import type { WordPressTokenUser } from '../contracts/wordpress-auth';

export type WordPressRequest = Request & { wpUser?: WordPressTokenUser };

@Injectable()
export class ApiTokenGuard implements CanActivate {
  constructor(private readonly tokenService: WordPressApiTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<WordPressRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('توکن API ارسال نشده است');
    }

    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException('توکن API ارسال نشده است');
    }

    req.wpUser = await this.tokenService.validateBearerToken(token);
    return true;
  }
}
