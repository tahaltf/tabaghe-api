export type StoryGenerationInput = {
  listingTitle: string;
  listingDescription: string;
  priceLabel?: string | null;
  userPrompt?: string | null;
  systemPrompt: string;
  constraints: string;
  stylePromptAddon?: string | null;
  styleLabel?: string | null;
};

export function buildStoryCaptionPrompt(input: StoryGenerationInput): {
  system: string;
  user: string;
} {
  const system = [
    input.systemPrompt,
    '',
    'محدودیت‌ها:',
    input.constraints,
    input.stylePromptAddon?.trim()
      ? `\nسبک بصری/لحن:\n${input.stylePromptAddon.trim()}`
      : null,
    '',
    'وظیفه: یک کپشن کوتاه فارسی برای استوری اینستاگرام بنویس (حداکثر ۲۵۰ کاراکتر).',
    'شماره تماس، واتساپ و تلگرام ننویس. CTA مناسب فروش در طبقه بده.',
  ]
    .filter(Boolean)
    .join('\n');

  const user = [
    `عنوان محصول: ${input.listingTitle}`,
    `توضیحات: ${input.listingDescription}`,
    input.priceLabel ? `قیمت: ${input.priceLabel}` : null,
    input.styleLabel ? `سبک انتخاب‌شده: ${input.styleLabel}` : null,
    input.userPrompt?.trim()
      ? `توضیحات فروشنده برای AI: ${input.userPrompt.trim()}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');

  return { system, user };
}

export function buildStoryImagePrompt(input: StoryGenerationInput): string {
  return [
    input.systemPrompt,
    'محدودیت‌ها:',
    input.constraints,
    input.stylePromptAddon?.trim()
      ? `سبک بصری:\n${input.stylePromptAddon.trim()}`
      : null,
    '',
    'عکس ورودی همان محصول واقعی فروشنده است. ظاهر و هویت محصول را حفظ کن و آن را به بنر استوری عمودی ۹:۱۶ تبدیل کن.',
    'پس‌زمینه حرفه‌ای و جذاب مطابق سبک بساز. متن روی تصویر کوتاه، خوانا و بدون شماره تماس باشد.',
    `عنوان محصول: ${input.listingTitle}`,
    input.priceLabel ? `قیمت: ${input.priceLabel}` : null,
    input.styleLabel ? `سبک: ${input.styleLabel}` : null,
    input.userPrompt?.trim()
      ? `درخواست فروشنده: ${input.userPrompt.trim()}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');
}
