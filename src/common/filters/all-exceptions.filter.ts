import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpException,
    HttpStatus,
} from '@nestjs/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const res = ctx.getResponse();
        const req = ctx.getRequest();

        const isHttp = exception instanceof HttpException;
        const status = isHttp
            ? exception.getStatus()
            : HttpStatus.INTERNAL_SERVER_ERROR;

        const response = isHttp ? exception.getResponse() : null;

        // پیام امن برای prod
        const safeMessage =
            status === HttpStatus.INTERNAL_SERVER_ERROR
                ? 'Internal server error'
                : (typeof response === 'string'
                ? response
                : (response as any)?.message) ?? 'Request failed';

        // در prod stack رو برنگردون
        const isProd = process.env.NODE_ENV === 'production';

        res.status(status).json({
            ok: false,
            statusCode: status,
            path: req.url,
            method: req.method,
            timestamp: new Date().toISOString(),
            message: safeMessage,
            ...(isProd
                ? {}
                : {
                    // برای dev فقط
                    debug: isHttp ? undefined : String(exception),
                }),
        });
    }
}
