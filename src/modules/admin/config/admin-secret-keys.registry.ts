export type AdminSecretKeyCategory =
  | 'sms'
  | 'payment'
  | 'marketing'
  | 'ai'
  | 'kyc'
  | 'web_push'
  | 'crawler'
  | 'general';

export type AdminSecretValueKind = 'secret' | 'url' | 'text';

export interface AdminSecretKeyDef {
  key: string;
  category: AdminSecretKeyCategory;
  categoryLabel: string;
  label: string;
  description?: string;
  kind: AdminSecretValueKind;
  placeholder?: string;
  /** اگر false باشد فقط از DB خوانده می‌شود (بدون fallback env) */
  envFallback?: boolean;
}

/** کلیدهای بحرانی که هرگز در این سیستم مدیریت نمی‌شوند */
export const BLOCKED_SECRET_ENV_KEYS = new Set([
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'JWT_ACCESS_TTL_SECONDS',
  'JWT_REFRESH_TTL_SECONDS',
  'ADMIN_SECRETS_ENC_KEY',
  'MARKETING_TOKEN_ENC_KEY',
  'NODE_ENV',
  'PORT',
]);

/**
 * Whitelist کلیدهای integration قابل مدیریت از پنل ادمین.
 * هر integration جدید باید entry مربوطه را اینجا اضافه کند.
 */
export const ADMIN_SECRET_KEYS_REGISTRY: AdminSecretKeyDef[] = [
  {
    key: 'SMS_IR_API_KEY',
    category: 'sms',
    categoryLabel: 'پیامک',
    label: 'کلید API sms.ir',
    description: 'کلید webservice از پنل sms.ir',
    kind: 'secret',
    placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
  },
  {
    key: 'KAVENEGAR_API_KEY',
    category: 'sms',
    categoryLabel: 'پیامک',
    label: 'کلید API کاوه‌نگار',
    kind: 'secret',
  },
  {
    key: 'SMS_IR_LINE_NUMBER',
    category: 'sms',
    categoryLabel: 'پیامک',
    label: 'شماره خط sms.ir',
    description: 'اختیاری — برای ارسال متنی بدون قالب',
    kind: 'text',
  },
  {
    key: 'ZIBAL_MERCHANT',
    category: 'payment',
    categoryLabel: 'درگاه پرداخت',
    label: 'Merchant زیبال',
    kind: 'text',
    placeholder: 'zibal',
  },
  {
    key: 'ZIBAL_REQUEST_URL',
    category: 'payment',
    categoryLabel: 'درگاه پرداخت',
    label: 'URL درخواست زیبال',
    kind: 'url',
    placeholder: 'https://gateway.zibal.ir/v1/request',
  },
  {
    key: 'ZIBAL_VERIFY_URL',
    category: 'payment',
    categoryLabel: 'درگاه پرداخت',
    label: 'URL تأیید زیبال',
    kind: 'url',
    placeholder: 'https://gateway.zibal.ir/v1/verify',
  },
  {
    key: 'ZIBAL_START_PAY_URL',
    category: 'payment',
    categoryLabel: 'درگاه پرداخت',
    label: 'URL شروع پرداخت زیبال',
    kind: 'url',
    placeholder: 'https://gateway.zibal.ir/start',
  },
  {
    key: 'ZIBAL_CALLBACK_URL',
    category: 'payment',
    categoryLabel: 'درگاه پرداخت',
    label: 'Callback زیبال',
    kind: 'url',
    placeholder: 'https://api.example.com/api/v1/payments/callback/zibal',
  },
  {
    key: 'FX_INGEST_SECRET',
    category: 'general',
    categoryLabel: 'عمومی',
    label: 'کلید ingest نرخ ارز (n8n)',
    description:
      'رمز مشترک برای POST/GET /api/v1/integrations/fx-rates — هدر X-Fx-Ingest-Key یا Bearer',
    kind: 'secret',
    placeholder: 'یک رشته تصادفی بلند',
  },
  {
    key: 'SELLER_CRM_INGEST_SECRET',
    category: 'crawler',
    categoryLabel: 'کرالر',
    label: 'کلید ingest لید دیوار',
    description:
      'رمز مشترک برای POST /api/v1/integrations/seller-crm/divar-leads — هدر X-Seller-Crm-Ingest-Key یا Bearer (همان مقدار روی کرالر)',
    kind: 'secret',
    placeholder: 'یک رشته تصادفی بلند',
  },
  {
    key: 'SELLER_CRM_CRAWLER_ADMIN_ID',
    category: 'crawler',
    categoryLabel: 'کرالر',
    label: 'ادمین ثبت‌کننده لید کرالر',
    description:
      'شناسه User ادمین برای createdByAdminId هنگام ثبت خودکار لید از کرالر دیوار (اختیاری؛ در غیر این صورت قدیمی‌ترین ادمین)',
    kind: 'text',
    placeholder: 'cuid ادمین',
  },
  {
    key: 'ZOHAL_TOKEN',
    category: 'kyc',
    categoryLabel: 'احراز هویت و استعلام',
    label: 'توکن API استعلام',
    description:
      'Bearer token سرویس‌دهنده استعلام — برای شاهکار، ثبت‌احوال، کد پستی و تطبیق کارت',
    kind: 'secret',
  },
  {
    key: 'ZOHAL_BASE_URL',
    category: 'kyc',
    categoryLabel: 'احراز هویت و استعلام',
    label: 'Base URL استعلام',
    description: 'آدرس پایه API سرویس استعلام (در صورت خالی بودن از مقدار پیش‌فرض استفاده می‌شود)',
    kind: 'url',
    placeholder: 'https://example.com/api/v0/services',
  },
  {
    key: 'META_INSTAGRAM_APP_ID',
    category: 'marketing',
    categoryLabel: 'مارکتینگ',
    label: 'Instagram App ID',
    description:
      'از App Dashboard → Instagram → Business login settings (نه Facebook App ID)',
    kind: 'text',
  },
  {
    key: 'META_INSTAGRAM_APP_SECRET',
    category: 'marketing',
    categoryLabel: 'مارکتینگ',
    label: 'Instagram App Secret',
    description: 'از همان صفحه Business login settings',
    kind: 'secret',
  },
  {
    key: 'META_APP_ID',
    category: 'marketing',
    categoryLabel: 'مارکتینگ',
    label: 'Meta App ID (fallback)',
    description:
      'اگر Instagram App ID جداگانه ندارید؛ ترجیحاً META_INSTAGRAM_APP_ID را پر کنید',
    kind: 'text',
  },
  {
    key: 'META_APP_SECRET',
    category: 'marketing',
    categoryLabel: 'مارکتینگ',
    label: 'Meta App Secret (fallback)',
    kind: 'secret',
  },
  {
    key: 'META_WEBHOOK_VERIFY_TOKEN',
    category: 'marketing',
    categoryLabel: 'مارکتینگ',
    label: 'Webhook Verify Token',
    description: 'توکن تأیید webhook اینستاگرام در Meta Developer',
    kind: 'secret',
  },
  {
    key: 'MARKETING_OAUTH_REDIRECT_URI',
    category: 'marketing',
    categoryLabel: 'مارکتینگ',
    label: 'OAuth Redirect URI',
    kind: 'url',
    placeholder:
      'https://api.example.com/api/v1/integrations/marketing/instagram/oauth/callback',
  },
  {
    key: 'API_PUBLIC_URL',
    category: 'marketing',
    categoryLabel: 'مارکتینگ',
    label: 'URL عمومی API',
    description: 'برای URL رسانه‌ای که Instagram باید بتواند دانلود کند',
    kind: 'url',
  },
  {
    key: 'LIARA_API_KEY',
    category: 'ai',
    categoryLabel: 'هوش مصنوعی',
    label: 'کلید API لیارا',
    description: 'کلید سرویس AI لیارا برای تولید محتوا / تصویر',
    kind: 'secret',
  },
  {
    key: 'LIARA_BASE_URL',
    category: 'ai',
    categoryLabel: 'هوش مصنوعی',
    label: 'Base URL لیارا',
    description:
      'آدرس اختصاصی workspace — مثل https://ai.liara.ir/api/<workspaceId>/v1',
    kind: 'url',
    placeholder: 'https://ai.liara.ir/api/6a787a10332d5f922cf9083c/v1',
  },
  {
    key: 'AI_CONTENT_OPENAI_API_KEY',
    category: 'ai',
    categoryLabel: 'هوش مصنوعی',
    label: 'کلید جایگزین OpenAI-compatible',
    description: 'اختیاری — اگر LIARA_API_KEY خالی باشد استفاده می‌شود',
    kind: 'secret',
  },
  {
    key: 'OPENAI_API_KEY',
    category: 'ai',
    categoryLabel: 'هوش مصنوعی',
    label: 'OpenAI API Key (fallback)',
    kind: 'secret',
  },
  {
    key: 'OPENAI_BASE_URL',
    category: 'ai',
    categoryLabel: 'هوش مصنوعی',
    label: 'OpenAI Base URL (fallback)',
    kind: 'url',
    placeholder: 'https://api.openai.com/v1',
  },
  {
    key: 'WEB_PUSH_VAPID_PUBLIC_KEY',
    category: 'web_push',
    categoryLabel: 'Web Push',
    label: 'VAPID Public Key',
    kind: 'secret',
  },
  {
    key: 'WEB_PUSH_VAPID_PRIVATE_KEY',
    category: 'web_push',
    categoryLabel: 'Web Push',
    label: 'VAPID Private Key',
    kind: 'secret',
  },
  {
    key: 'WEB_PUSH_VAPID_SUBJECT',
    category: 'web_push',
    categoryLabel: 'Web Push',
    label: 'VAPID Subject',
    kind: 'text',
    placeholder: 'mailto:support@example.com',
  },
  {
    key: 'API_URL',
    category: 'general',
    categoryLabel: 'عمومی',
    label: 'آدرس API',
    kind: 'url',
    placeholder: 'https://api.example.com',
  },
  {
    key: 'FRONTEND_APP_URL',
    category: 'general',
    categoryLabel: 'عمومی',
    label: 'آدرس فرانت',
    kind: 'url',
    placeholder: 'https://example.com',
  },
  {
    key: 'PAYMENT_RETURN_URL',
    category: 'general',
    categoryLabel: 'عمومی',
    label: 'URL بازگشت پرداخت',
    kind: 'url',
  },
  {
    key: 'FRONTEND_ORIGINS',
    category: 'general',
    categoryLabel: 'عمومی',
    label: 'Origins مجاز CORS',
    description: 'با کاما جدا شوند',
    kind: 'text',
    placeholder: 'https://example.com,https://www.example.com',
  },
];

const registryByKey = new Map(
  ADMIN_SECRET_KEYS_REGISTRY.map((def) => [def.key, def]),
);

export function getAdminSecretKeyDef(key: string): AdminSecretKeyDef | undefined {
  return registryByKey.get(key);
}

export function assertAdminSecretKey(key: string): AdminSecretKeyDef {
  const def = getAdminSecretKeyDef(key);
  if (!def) {
    throw new Error(`Secret key "${key}" is not registered`);
  }
  return def;
}

export function isRegisteredAdminSecretKey(key: string): boolean {
  return registryByKey.has(key);
}

export function maskAdminSecretValue(
  value: string,
  kind: AdminSecretValueKind = 'secret',
): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  if (kind === 'url') {
    try {
      const url = new URL(trimmed);
      const host = url.host;
      if (host.length <= 6) return '***';
      return `${url.protocol}//***${host.slice(-4)}${url.pathname !== '/' ? '/…' : ''}`;
    } catch {
      // fall through
    }
  }

  if (trimmed.length <= 4) {
    return '*'.repeat(Math.max(4, trimmed.length));
  }
  return `${'*'.repeat(8)}${trimmed.slice(-4)}`;
}

export function validateAdminSecretValue(
  def: AdminSecretKeyDef,
  value: string,
): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'مقدار نمی‌تواند خالی باشد';
  }

  if (def.kind === 'url') {
    try {
      const url = new URL(trimmed);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return 'URL باید با http:// یا https:// شروع شود';
      }
    } catch {
      return 'URL نامعتبر است';
    }
  }

  if (def.key === 'WEB_PUSH_VAPID_SUBJECT' && !/^mailto:.+@.+/.test(trimmed)) {
    return 'Subject باید به صورت mailto:email@domain.com باشد';
  }

  if (def.key === 'FRONTEND_ORIGINS') {
    const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
    if (!parts.length) {
      return 'حداقل یک origin لازم است';
    }
    for (const part of parts) {
      try {
        // eslint-disable-next-line no-new
        new URL(part);
      } catch {
        return `Origin نامعتبر: ${part}`;
      }
    }
  }

  if (def.kind === 'secret' && trimmed.length < 4) {
    return 'کلید secret باید حداقل ۴ کاراکتر باشد';
  }

  return null;
}

export function groupAdminSecretCatalog(): Array<{
  category: AdminSecretKeyCategory;
  categoryLabel: string;
  keys: AdminSecretKeyDef[];
}> {
  const groups = new Map<
    AdminSecretKeyCategory,
    { categoryLabel: string; keys: AdminSecretKeyDef[] }
  >();

  for (const def of ADMIN_SECRET_KEYS_REGISTRY) {
    const existing = groups.get(def.category);
    if (existing) {
      existing.keys.push(def);
      continue;
    }
    groups.set(def.category, {
      categoryLabel: def.categoryLabel,
      keys: [def],
    });
  }

  return [...groups.entries()].map(([category, value]) => ({
    category,
    categoryLabel: value.categoryLabel,
    keys: value.keys,
  }));
}
