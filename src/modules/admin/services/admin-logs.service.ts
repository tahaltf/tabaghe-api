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

  listAuctionLedger(limit = 500) {
    return readRecentJsonLogs('auction-ledger.log', limit);
  }

  listAuctionTimeline(limit = 500) {
    return readRecentJsonLogs('auction-timeline.log', limit);
  }

  listSettingsAudit(limit = 200) {
    return readRecentJsonLogs('settings-audit.log', limit);
  }
}
