import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { Request } from 'express';
import {
  ApiSuccessResponse,
  buildSuccessEnvelope,
} from '../../shared/contracts/api-response';
import { RAW_RESPONSE_KEY } from '../decorators/raw-response.decorator';

type MaybeEnvelope<T> = T | ApiSuccessResponse<T>;

function isAlreadyEnvelope(
  value: unknown,
): value is ApiSuccessResponse<unknown> {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj['success'] === 'boolean' &&
    'data' in obj &&
    'meta' in obj &&
    'error' in obj
  );
}

/**
 * هر پاسخ HTTP موفق را در envelope استاندارد می‌پیچد.
 * endpoint هایی با @RawResponse() نادیده گرفته می‌شوند.
 * stream ها و StreamableFile هم دست‌نخورده می‌مانند.
 */
@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<
  T,
  MaybeEnvelope<T>
> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<MaybeEnvelope<T>> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const isRaw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isRaw) return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const path = req.originalUrl || req.url;

    return next.handle().pipe(
      map((data) => {
        if (data instanceof StreamableFile)
          return data as unknown as MaybeEnvelope<T>;
        if (isAlreadyEnvelope(data)) return data as ApiSuccessResponse<T>;

        let payload: unknown = data;
        const extraMeta: Record<string, unknown> = { path };

        if (
          data &&
          typeof data === 'object' &&
          'items' in (data as Record<string, unknown>) &&
          'pagination' in (data as Record<string, unknown>)
        ) {
          const paginated = data as unknown as {
            items: unknown;
            pagination: unknown;
          };
          payload = paginated.items;
          extraMeta.pagination = paginated.pagination;
        }

        return buildSuccessEnvelope(payload as T, extraMeta);
      }),
    );
  }
}
