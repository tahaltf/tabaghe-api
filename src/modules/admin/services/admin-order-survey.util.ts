import { SurveyRole } from '@prisma/client';
import { getFrontendAppOrigin } from '../../../common/pwa-brand-icon.util';

export type SurveyRowForAdmin = {
  role: SurveyRole;
  score: number | null;
  comment: string | null;
  scheduledSendAt: Date | null;
  sentAt: Date | null;
  respondedAt: Date | null;
  openedAt: Date | null;
  expiresAt: Date | null;
  surveyPath: string;
  surveyUrl: string;
};

type SurveySource = {
  role: SurveyRole;
  token: string;
  score: number | null;
  comment: string | null;
  scheduledSendAt?: Date | null;
  sentAt: Date | null;
  respondedAt: Date | null;
  openedAt?: Date | null;
  expiresAt?: Date | null;
};

export function mapSurveyForAdmin(row: SurveySource): SurveyRowForAdmin {
  const surveyPath = `/survey/${row.token}`;
  return {
    role: row.role,
    score: row.score,
    comment: row.comment,
    scheduledSendAt: row.scheduledSendAt ?? null,
    sentAt: row.sentAt,
    respondedAt: row.respondedAt,
    openedAt: row.openedAt ?? null,
    expiresAt: row.expiresAt ?? null,
    surveyPath,
    surveyUrl: `${getFrontendAppOrigin()}${surveyPath}`,
  };
}

export const ADMIN_ORDER_SURVEY_SELECT = {
  role: true,
  token: true,
  score: true,
  comment: true,
  scheduledSendAt: true,
  sentAt: true,
  respondedAt: true,
  openedAt: true,
  expiresAt: true,
} as const;
