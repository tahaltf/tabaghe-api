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
} as const;

export const AI_CONTENT_UPLOAD_DIR = './uploads/ai-content';

export const DEFAULT_AI_STORY_SYSTEM_PROMPT =
  'تو طراح بنر فروش حرفه‌ای برای پلتفرم بازار آنلاین «طبقه» هستی. خروجی باید مناسب استوری اینستاگرام (عمودی ۹:۱۶) باشد، جذاب، خوانا و قابل اعتماد برای خریدار ایرانی.';

export const DEFAULT_AI_STORY_CONSTRAINTS =
  'شماره تماس، واتساپ، تلگرام و هر راه ارتباطی مستقیم تحت هیچ شرایطی روی تصویر نباشد. بنر باید حس فروش از طریق پلتفرم طبقه را منتقل کند. از ادعاهای گمراه‌کننده پرهیز کن. هویت بصری محصول در عکس ورودی را حفظ کن و آن را جایگزین محصول دیگری نکن.';

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
export const DEFAULT_AI_IMAGE_MODEL = 'openai/gpt-image-1';
