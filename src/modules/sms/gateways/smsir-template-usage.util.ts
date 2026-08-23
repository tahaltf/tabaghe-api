import { SMS_SETTING_KEYS } from '../../sms/sms.service';

export interface SmsIrTemplateUsageLocation {
  /** Human-readable location label (Persian) */
  label: string;
  /** settings | notification-single | notification-batch */
  category: 'settings' | 'notification-single' | 'notification-batch';
  /** Setting key or notification ruleKey */
  key: string;
  smsEnabled?: boolean;
}

export interface SmsIrTemplateUsageEntry {
  templateId: number;
  count: number;
  locations: SmsIrTemplateUsageLocation[];
}

export interface SmsIrTemplateUsageMap {
  /** templateId string -> usage entry */
  byTemplateId: Record<string, SmsIrTemplateUsageEntry>;
  totalReferences: number;
}

const SITE_TEMPLATE_FIELDS: Array<{ key: string; label: string }> = [
  { key: SMS_SETTING_KEYS.OTP_TEMPLATE_ID, label: 'OTP ورود' },
  { key: SMS_SETTING_KEYS.WITHDRAW_OTP_TEMPLATE_ID, label: 'OTP برداشت کیف پول' },
  {
    key: SMS_SETTING_KEYS.ADMIN_LOGIN_ALERT_TEMPLATE_ID,
    label: 'هشدار ورود ادمین',
  },
  { key: SMS_SETTING_KEYS.DEPLOY_ALERT_TEMPLATE_ID, label: 'نتیجه دیپلوی' },
  { key: SMS_SETTING_KEYS.UPTIME_ALERT_TEMPLATE_ID, label: 'مانیتور uptime' },
];

type SavedNotificationRule = {
  smsEnabled?: boolean;
  smsTemplateConfig?: { templateId?: number; smsProvider?: string };
  batchSmsTemplateConfig?: { templateId?: number; smsProvider?: string };
};

function parseTemplateId(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function addUsage(
  map: Record<string, SmsIrTemplateUsageEntry>,
  templateId: number,
  location: SmsIrTemplateUsageLocation,
): void {
  const id = String(templateId);
  const existing = map[id];
  if (existing) {
    existing.count += 1;
    existing.locations.push(location);
    return;
  }
  map[id] = { templateId, count: 1, locations: [location] };
}

export function buildSmsIrTemplateUsageMap(input: {
  siteSettings: Record<string, string | undefined>;
  notificationRulesJson?: string | null;
}): SmsIrTemplateUsageMap {
  const byTemplateId: Record<string, SmsIrTemplateUsageEntry> = {};
  let totalReferences = 0;

  for (const field of SITE_TEMPLATE_FIELDS) {
    const templateId = parseTemplateId(input.siteSettings[field.key]);
    if (templateId == null) continue;
    addUsage(byTemplateId, templateId, {
      label: field.label,
      category: 'settings',
      key: field.key,
    });
    totalReferences += 1;
  }

  const raw = input.notificationRulesJson?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, SavedNotificationRule>;
      for (const [ruleKey, rule] of Object.entries(parsed)) {
        const singleId = parseTemplateId(rule?.smsTemplateConfig?.templateId);
        if (singleId != null) {
          addUsage(byTemplateId, singleId, {
            label: ruleKey,
            category: 'notification-single',
            key: ruleKey,
            smsEnabled: rule.smsEnabled === true,
          });
          totalReferences += 1;
        }

        const batchId = parseTemplateId(rule?.batchSmsTemplateConfig?.templateId);
        if (batchId != null) {
          addUsage(byTemplateId, batchId, {
            label: `${ruleKey} (گروهی)`,
            category: 'notification-batch',
            key: ruleKey,
            smsEnabled: rule.smsEnabled === true,
          });
          totalReferences += 1;
        }
      }
    } catch {
      // ignore malformed JSON
    }
  }

  return { byTemplateId, totalReferences };
}

export function getSmsIrTemplateUsageKeys(): string[] {
  return [
    ...SITE_TEMPLATE_FIELDS.map((f) => f.key),
    'SMS_NOTIFICATION_RULES',
  ];
}
