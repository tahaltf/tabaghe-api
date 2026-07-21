export type StoryGenerationInput = {
  listingTitle: string;
  listingDescription: string;
  priceLabel?: string | null;
  userPrompt?: string | null;
  systemPrompt: string;
  constraints: string;
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
    '',
    'وظیفه: یک کپشن کوتاه فارسی برای استوری اینستاگرام بنویس (حداکثر ۲۵۰ کاراکتر).',
    'شماره تماس، واتساپ و تلگرام ننویس. CTA مناسب فروش در طبقه بده.',
  ].join('\n');

  const user = [
    `عنوان محصول: ${input.listingTitle}`,
    `توضیحات: ${input.listingDescription}`,
    input.priceLabel ? `قیمت: ${input.priceLabel}` : null,
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
    '',
    'یک بنر استوری عمودی ۹:۱۶ برای فروش این محصول بساز.',
    'از عکس محصول استفاده کن و پس‌زمینه حرفه‌ای و جذاب اضافه کن.',
    'متن روی تصویر کوتاه، خوانا و بدون شماره تماس باشد.',
    `عنوان محصول: ${input.listingTitle}`,
    input.priceLabel ? `قیمت: ${input.priceLabel}` : null,
    input.userPrompt?.trim()
      ? `درخواست فروشنده: ${input.userPrompt.trim()}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');
}
