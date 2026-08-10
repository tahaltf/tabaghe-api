export const AI_CONTENT_SETTING_KEYS = {
  ENABLED: 'AI_ENABLED',
  KYC_WELCOME_TOKENS: 'AI_KYC_WELCOME_TOKENS',
  STORY_TOKEN_COST: 'AI_STORY_TOKEN_COST',
  TOKEN_PRICE_TOMAN: 'AI_TOKEN_PRICE_TOMAN',
  TOKEN_PACKS_JSON: 'AI_TOKEN_PACKS_JSON',
  STORY_SYSTEM_PROMPT: 'AI_STORY_SYSTEM_PROMPT',
  STORY_CONSTRAINTS: 'AI_STORY_CONSTRAINTS',
  STORY_BRAND_LOGO_URL: 'AI_STORY_BRAND_LOGO_URL',
  STORY_STYLES_JSON: 'AI_STORY_STYLES_JSON',
  TEXT_MODEL: 'AI_TEXT_MODEL',
  IMAGE_MODEL: 'AI_IMAGE_MODEL',
  DAILY_LIMIT_PER_USER: 'AI_DAILY_LIMIT_PER_USER',
  /** حداکثر انتظار برای images/edits لیارا (میلی‌ثانیه) */
  IMAGE_EDIT_TIMEOUT_MS: 'AI_IMAGE_EDIT_TIMEOUT_MS',
  /** سایز خروجی مدل تصویر (مثلاً 1024x1536) */
  IMAGE_SIZE: 'AI_IMAGE_SIZE',
  /** حداکثر ضلع عکس ورودی قبل از ارسال به لیارا */
  IMAGE_INPUT_MAX_PX: 'AI_IMAGE_INPUT_MAX_PX',
} as const;

export const AI_CONTENT_UPLOAD_DIR = './uploads/ai-content';

export const DEFAULT_AI_STORY_SYSTEM_PROMPT =
  'تو طراح استوری فروش حرفه‌ای برای پلتفرم بازار آنلاین «طبقه» هستی. خروجی استوری اینستاگرام عمودی ۹:۱۶، جذاب، خوانا و قابل اعتماد برای خریدار ایرانی باشد.';

export const DEFAULT_AI_STORY_CONSTRAINTS =
  'شماره تماس، واتساپ، تلگرام و هر راه ارتباطی مستقیم روی تصویر نباشد. حس خرید از «طبقه» را منتقل کن. از ادعاهای گمراه‌کننده پرهیز کن. خودِ محصول ورودی را عوض نکن و محصول دیگری نساز؛ اما اجازه داری همان محصول را در صحنه جدید (مثل دست مدل، استایل لایف‌استایل، نور استودیو) دوباره بچینی و پس‌زمینه حرفه‌ای بسازی.';

export const DEFAULT_AI_TOKEN_PACKS = [1, 5, 10, 20];

export type AiStoryStyleDef = {
  id: string;
  label: string;
  promptAddon: string;
  enabled: boolean;
  sortOrder: number;
};

export const DEFAULT_AI_STORY_STYLES: AiStoryStyleDef[] = [
  {
    id: 'minimal',
    label: 'مینیمال',
    promptAddon:
      'سبک مینیمال: فضای خلوت، پس‌زمینه ساده روشن یا خنثی، تایپوگرافی تمیز، تمرکز کامل روی محصول، بدون شلوغی بصری.',
    enabled: true,
    sortOrder: 1,
  },
  {
    id: 'formal',
    label: 'رسمی',
    promptAddon:
      'سبک رسمی و لوکس: ترکیب‌بندی مرتب، نورپردازی حرفه‌ای استودیویی، حس اعتماد و کیفیت بالا، رنگ‌های کلاسیک و متین.',
    enabled: true,
    sortOrder: 2,
  },
  {
    id: 'sport',
    label: 'اسپرت',
    promptAddon:
      'سبک اسپرت و پویا: انرژی بالا، کنتراست قوی، خطوط مورب، حس حرکت و جوانی، مناسب کالای ورزشی یا سبک زندگی فعال.',
    enabled: true,
    sortOrder: 3,
  },
  {
    id: 'classic',
    label: 'کلاسیک',
    promptAddon:
      'سبک کلاسیک: حس نوستالژیک و اصیل، بافت‌های گرم، ترکیب‌بندی متقارن، مناسب محصولات سنتی یا باکیفیت ماندگار.',
    enabled: true,
    sortOrder: 4,
  },
  {
    id: 'fantasy',
    label: 'فانتزی',
    promptAddon:
      'سبک فانتزی و خلاق: فضای رویایی، رنگ‌های زنده‌تر، المان‌های خلاقانه در پس‌زمینه، بدون مخدوش کردن ظاهر واقعی محصول.',
    enabled: true,
    sortOrder: 5,
  },
];

export const DEFAULT_AI_TEXT_MODEL = 'openai/gpt-4o-mini';
export const DEFAULT_AI_IMAGE_MODEL = 'openai/gpt-image-1-mini';

/** پیش‌فرض‌های سرعت — جاب async است؛ مهلت باید برای images/edits واقعی کافی باشد */
export const DEFAULT_AI_IMAGE_EDIT_TIMEOUT_MS = 90_000;
export const DEFAULT_AI_IMAGE_SIZE = '1024x1536';
export const DEFAULT_AI_IMAGE_INPUT_MAX_PX = 768;

export const AI_IMAGE_EDIT_TIMEOUT_MS_MIN = 15_000;
export const AI_IMAGE_EDIT_TIMEOUT_MS_MAX = 180_000;
export const AI_IMAGE_INPUT_MAX_PX_MIN = 512;
export const AI_IMAGE_INPUT_MAX_PX_MAX = 1536;

export type AiModelOption = {
  id: string;
  label: string;
};

export type AiImageSizeOption = {
  id: string;
  label: string;
};

/** مدل‌های متن پیشنهادی لیارا (OpenAI) برای کپشن */
export const AI_TEXT_MODEL_OPTIONS: AiModelOption[] = [
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini (پیشنهادی)' },
  { id: 'openai/gpt-4o', label: 'GPT-4o' },
  { id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 Mini' },
  { id: 'openai/gpt-4.1', label: 'GPT-4.1' },
  { id: 'openai/o4-mini', label: 'o4 Mini' },
];

/** مدل‌های تصویر پیشنهادی لیارا برای استوری */
export const AI_IMAGE_MODEL_OPTIONS: AiModelOption[] = [
  { id: 'openai/gpt-image-1-mini', label: 'GPT Image 1 Mini (پیشنهادی)' },
  { id: 'openai/gpt-image-1', label: 'GPT Image 1' },
  { id: 'openai/gpt-image-1.5', label: 'GPT Image 1.5' },
];

/** سایزهای مجاز images/edits */
export const AI_IMAGE_SIZE_OPTIONS: AiImageSizeOption[] = [
  {
    id: '1024x1536',
    label: '۱۰۲۴×۱۵۳۶ عمودی (کیفیت استوری — کندتر)',
  },
  {
    id: '1024x1024',
    label: '۱۰۲۴×۱۰۲۴ مربع (سریع‌تر؛ بعداً به ۹:۱۶ کشیده می‌شود)',
  },
  {
    id: '1536x1024',
    label: '۱۵۳۶×۱۰۲۴ افقی',
  },
];

export const AI_IMAGE_SIZE_IDS = AI_IMAGE_SIZE_OPTIONS.map((o) => o.id);
