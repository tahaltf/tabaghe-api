/** کلیدهای SystemSetting مربوط به سرویس استعلام */
export const ZOHAL_SETTING_KEYS = {
  IDENTITY_ENABLED: 'ZOHAL_IDENTITY_ENABLED',
  POSTAL_ENABLED: 'ZOHAL_POSTAL_ENABLED',
  CARD_MATCH_ENABLED: 'ZOHAL_CARD_MATCH_ENABLED',
  IDENTITY_MAX_FAILURES: 'ZOHAL_IDENTITY_MAX_FAILURES',
  CARD_MATCH_MAX_FAILURES: 'ZOHAL_CARD_MATCH_MAX_FAILURES',
  IDENTITY_FAILURE_COUNT: 'ZOHAL_IDENTITY_FAILURE_COUNT',
  CARD_MATCH_FAILURE_COUNT: 'ZOHAL_CARD_MATCH_FAILURE_COUNT',
} as const;

export const ZOHAL_SETTING_DEFAULTS: Record<string, string> = {
  [ZOHAL_SETTING_KEYS.IDENTITY_ENABLED]: 'true',
  [ZOHAL_SETTING_KEYS.POSTAL_ENABLED]: 'true',
  [ZOHAL_SETTING_KEYS.CARD_MATCH_ENABLED]: 'true',
  [ZOHAL_SETTING_KEYS.IDENTITY_MAX_FAILURES]: '50',
  [ZOHAL_SETTING_KEYS.CARD_MATCH_MAX_FAILURES]: '50',
  [ZOHAL_SETTING_KEYS.IDENTITY_FAILURE_COUNT]: '0',
  [ZOHAL_SETTING_KEYS.CARD_MATCH_FAILURE_COUNT]: '0',
};

export type ZohalFailureService = 'identity' | 'card_match';

export type KycFormMode = 'auto' | 'manual';

export type KycFormConfig = {
  mode: KycFormMode;
  identityActive: boolean;
  failureCount: number;
  maxFailures: number;
};

export type PostalLookupResult =
  | {
      ok: true;
      province: string;
      city: string;
      district?: string;
      fullAddress: string;
    }
  | {
      ok: false;
      manual: true;
      reason: 'disabled' | 'inquiry_failed';
    };
