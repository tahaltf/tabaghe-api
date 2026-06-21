import {
  Injectable,
  NestMiddleware,
  NotFoundException,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TrackingService } from './tracking.service';
import { CampaignPrefixService } from './campaign-prefix.service';

@Injectable()
export class TrackingRedirectMiddleware implements NestMiddleware {
  constructor(
    private readonly tracking: TrackingService,
    private readonly prefixService: CampaignPrefixService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const segments = req.path.replace(/^\//, '').split('/').filter(Boolean);
    if (segments.length !== 2) {
      next();
      return;
    }

    const [prefix, slugRaw] = segments;
    if (!this.prefixService.isAllowedPrefix(prefix)) {
      next();
      return;
    }

    const slug = String(slugRaw ?? '').trim().toLowerCase();
    if (!slug) {
      next();
      return;
    }

    try {
      const result = await this.tracking.handleRedirect(slug, req);
      if (result.setCookie) {
        res.setHeader('Set-Cookie', result.setCookie);
      }
      res.redirect(302, result.url);
    } catch (err) {
      if (err instanceof NotFoundException) {
        res.status(404).send('لینک یافت نشد');
        return;
      }
      next(err);
    }
  }
}
