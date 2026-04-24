import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ApiErrorDetails,
  buildErrorEnvelope,
} from '../../shared/contracts/api-response';
import { ApiErrorCode } from '../../shared/contracts/enums';

interface NestHttpExceptionResponse {
  message?: string | string[];
  error?: string;
  statusCode?: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapStatusToCode(status: number): ApiErrorCode {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return ApiErrorCode.BAD_REQUEST;
    case HttpStatus.UNAUTHORIZED:
      return ApiErrorCode.UNAUTHORIZED;
    case HttpStatus.FORBIDDEN:
      return ApiErrorCode.FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return ApiErrorCode.NOT_FOUND;
    case HttpStatus.CONFLICT:
      return ApiErrorCode.CONFLICT;
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return ApiErrorCode.UNPROCESSABLE_ENTITY;
    case HttpStatus.TOO_MANY_REQUESTS:
      return ApiErrorCode.RATE_LIMITED;
    default:
      return status >= 500 ? ApiErrorCode.INTERNAL_ERROR : ApiErrorCode.BAD_REQUEST;
  }
}

function extractFieldErrors(messages: string[]): Record<string, string[]> | undefined {
  const fieldErrors: Record<string, string[]> = {};
  let hasField = false;
  for (const m of messages) {
    const match = /^([a-zA-Z0-9_.]+)\s+(.+)$/.exec(m);
    if (match) {
      hasField = true;
      const [, field, msg] = match;
      fieldErrors[field] ??= [];
      fieldErrors[field].push(msg);
    }
  }
  return hasField ? fieldErrors : undefined;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const isProd = process.env.NODE_ENV === 'production';

    let message = 'درخواست ناموفق بود';
    let fieldErrors: Record<string, string[]> | undefined;

    if (isHttp) {
      const response = exception.getResponse();
      if (typeof response === 'string') {
        message = response;
      } else if (isPlainObject(response)) {
        const nestResp = response as NestHttpExceptionResponse;
        if (Array.isArray(nestResp.message)) {
          fieldErrors = extractFieldErrors(nestResp.message);
          message = nestResp.message.join('; ');
        } else if (typeof nestResp.message === 'string') {
          message = nestResp.message;
        } else if (typeof nestResp.error === 'string') {
          message = nestResp.error;
        }
      }
    }

    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      message = isProd ? 'خطای داخلی سرور' : message || 'خطای داخلی سرور';
      this.logger.error(
        `Unhandled exception on ${req.method} ${req.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const errorDetails: ApiErrorDetails = {
      code: mapStatusToCode(status),
      message,
      ...(fieldErrors ? { fieldErrors } : {}),
      ...(isProd
        ? {}
        : {
            debug:
              exception instanceof Error
                ? `${exception.name}: ${exception.message}`
                : String(exception),
          }),
    };

    const envelope = buildErrorEnvelope(errorDetails, {
      path: req.originalUrl || req.url,
    });

    res.status(status).json(envelope);
  }
}
