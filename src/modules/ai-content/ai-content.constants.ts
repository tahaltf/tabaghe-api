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
  /** وقتی با کد عوض شد، استایل‌های ذخیره‌شده در DB یک‌بار با پیش‌فرض‌های جدید هم‌تراز می‌شوند */
  STORY_STYLES_SEED_VERSION: 'AI_STORY_STYLES_SEED_VERSION',
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

/** با هر بازنویسی meaningful سبک‌ها این عدد را بالا ببرید تا پروداکشن یک‌بار sync شود */
export const AI_STORY_STYLES_SEED_VERSION = '4';

export const AI_CONTENT_UPLOAD_DIR = './uploads/ai-content';

/** لوگوی پیش‌فرض برند طبقه برای واترمارک استوری */
export const DEFAULT_TABAGHEH_BRAND_LOGO_PATH = './assets/brand/logo-light-theme.png';

export const DEFAULT_AI_STORY_SYSTEM_PROMPT =
  'تو آرت‌دایرکتور و طراح استوری فروش حرفه‌ای برای بازار آنلاین «طبقه» هستی. خروجی باید مثل استوری لوکس اینستاگرام فروشگاهی باشد (۹:۱۶): صحنه لایف‌استایل بازآرایی‌شده + تایپوگرافی ادیتوریال تمیز — نه عکس کاتالوگ با نوار متن.';

export const DEFAULT_AI_STORY_CONSTRAINTS =
  'شماره تماس، واتساپ، تلگرام و راه ارتباطی مستقیم روی تصویر نباشد. حس خرید از «طبقه» را منتقل کن. محصول ورودی را عوض نکن؛ همان محصول را در صحنه جدید (دست مدل، لایف‌استایل، استودیو) بازآرایی کن. تایپوگرافی، قیمت و برند طبقه را یکپارچه داخل فریم بگذار — هرگز نوار مستطیلی زشت زیر عکس نچسبان.';

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
      'Minimal luxury jewelry-ad Story: soft cream fabric folds, airy negative space, soft daylight, left editorial type stack (cocoa/brown), modern price pill, calm premium — never flat white paste + footer text bar.',
    enabled: true,
    sortOrder: 1,
  },
  {
    id: 'formal',
    label: 'رسمی',
    promptAddon:
      'Formal luxury studio Story: polished composition, professional studio light, muted classic palette, trust and quality, elegant typography and price badge — premium marketplace ad.',
    enabled: true,
    sortOrder: 2,
  },
  {
    id: 'sport',
    label: 'اسپرت',
    promptAddon:
      'Sporty dynamic Story: high energy, strong contrast, diagonal motion, youthful lifestyle, still clear product and readable modern type.',
    enabled: true,
    sortOrder: 3,
  },
  {
    id: 'classic',
    label: 'کلاسیک',
    promptAddon:
      'Classic heritage Story: warm textures, balanced layout, timeless materials feel, soft cinematic light, elegant serif/sans mix for titles.',
    enabled: true,
    sortOrder: 4,
  },
  {
    id: 'fantasy',
    label: 'فانتزی',
    promptAddon:
      'Creative fantasy Story: dreamy atmosphere, richer accents, imaginative set — keep real product identity and still include clean readable type + price.',
    enabled: true,
    sortOrder: 5,
  },
];

export const DEFAULT_AI_TEXT_MODEL = 'openai/gpt-4o-mini';
/** مدل تصویر پیشنهادی لیارا — gpt-image-2 */
export const DEFAULT_AI_IMAGE_MODEL = 'openai/gpt-image-2';

/** Base URL پیش‌فرض سرویس AI لیارا (workspace طبقه) */
export const DEFAULT_LIARA_BASE_URL =
  'https://ai.liara.ir/api/6a787a10332d5f922cf9083c/v1';

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
  { id: 'openai/gpt-image-2', label: 'GPT Image 2 (پیشنهادی)' },
  { id: 'openai/gpt-image-1.5', label: 'GPT Image 1.5' },
  { id: 'openai/gpt-image-1', label: 'GPT Image 1' },
  { id: 'openai/gpt-image-1-mini', label: 'GPT Image 1 Mini (ارزان‌تر)' },
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
