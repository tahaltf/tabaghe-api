import { Injectable } from '@nestjs/common';
import { readRecentJsonLogs } from '../../../common/logging/app-log.util';

@Injectable()
export class AdminLogsService {
  listAppErrors(limit = 200) {
    return readRecentJsonLogs('app-errors.log', limit);
  }

  listTermsConsents(limit = 200) {
    return readRecentJsonLogs('terms-consent.log', limit);
  }
}
