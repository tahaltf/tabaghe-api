import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
    use(req: any, res: any, next: () => void) {
        const requestId = randomUUID();
        const start = Date.now();

        req.requestId = requestId;
        res.setHeader('X-Request-Id', requestId);

        res.on('finish', () => {
            const duration = Date.now() - start;

            // لاگ خیلی مینیمال
            console.log(
                JSON.stringify({
                    requestId,
                    method: req.method,
                    url: req.originalUrl,
                    statusCode: res.statusCode,
                    durationMs: duration,
                }),
            );
        });

        next();
    }
}
