import {
  Injectable,
  NestMiddleware,
  NotFoundException,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TrackingService } from './tracking.service';

@Injectable()
export class TrackingRedirectMiddleware implements NestMiddleware {
  constructor(private readonly tracking: TrackingService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const slug = String(req.params['slug'] ?? '').trim().toLowerCase();
    if (!slug) {
      next();
      return;
    }

    try {
      const redirectUrl = await this.tracking.handleRedirect(slug, req);
      res.redirect(302, redirectUrl);
    } catch (err) {
      if (err instanceof NotFoundException) {
        res.status(404).send('لینک یافت نشد');
        return;
      }
      next(err);
    }
  }
}
