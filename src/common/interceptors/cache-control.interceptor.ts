import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { CACHE_CONTROL_KEY } from '../decorators/cache-control.decorator';

@Injectable()
export class CacheControlInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.method !== 'GET') {
      return next.handle();
    }

    const value = this.reflector.getAllAndOverride<string | undefined>(
      CACHE_CONTROL_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!value) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        const res = context.switchToHttp().getResponse<Response>();
        if (!res.getHeader('Cache-Control')) {
          res.setHeader('Cache-Control', value);
        }
      }),
    );
  }
}
