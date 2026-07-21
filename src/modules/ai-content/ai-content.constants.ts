export const AI_CONTENT_SETTING_KEYS = {
  ENABLED: 'AI_ENABLED',
  KYC_WELCOME_TOKENS: 'AI_KYC_WELCOME_TOKENS',
  STORY_TOKEN_COST: 'AI_STORY_TOKEN_COST',
  TOKEN_PRICE_TOMAN: 'AI_TOKEN_PRICE_TOMAN',
  TOKEN_PACKS_JSON: 'AI_TOKEN_PACKS_JSON',
  STORY_SYSTEM_PROMPT: 'AI_STORY_SYSTEM_PROMPT',
  STORY_CONSTRAINTS: 'AI_STORY_CONSTRAINTS',
  STORY_BRAND_LOGO_URL: 'AI_STORY_BRAND_LOGO_URL',
  TEXT_MODEL: 'AI_TEXT_MODEL',
  IMAGE_MODEL: 'AI_IMAGE_MODEL',
  DAILY_LIMIT_PER_USER: 'AI_DAILY_LIMIT_PER_USER',
} as const;

export const AI_CONTENT_UPLOAD_DIR = './uploads/ai-content';

export const DEFAULT_AI_STORY_SYSTEM_PROMPT =
  'تو طراح بنر فروش حرفه‌ای برای پلتفرم بازار آنلاین «طبقه» هستی. خروجی باید مناسب استوری اینستاگرام (عمودی ۹:۱۶) باشد، جذاب، خوانا و قابل اعتماد برای خریدار ایرانی.';

export const DEFAULT_AI_STORY_CONSTRAINTS =
  'شماره تماس، واتساپ، تلگرام و هر راه ارتباطی مستقیم تحت هیچ شرایطی روی تصویر نباشد. بنر باید حس فروش از طریق پلتفرم طبقه را منتقل کند. از ادعاهای گمراه‌کننده پرهیز کن.';

export const DEFAULT_AI_TOKEN_PACKS = [1, 5, 10, 20];
