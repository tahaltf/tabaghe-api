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

/**
 * پرامپت کوتاه و بصری برای images/edits.
 * درخواست صحنه‌آرایی فروشنده اولویت دارد؛ محصول ورودی حفظ می‌شود ولی می‌تواند در صحنه جدید قرار گیرد.
 */
export function buildStoryImagePrompt(input: StoryGenerationInput): string {
  const sellerAsk = input.userPrompt?.trim();
  const style = input.stylePromptAddon?.trim() || input.styleLabel?.trim() || '';

  const parts = [
    'Create a premium Instagram Story banner, vertical 9:16.',
    'The attached image is the REAL product. Keep the exact same product (shape, material, details). Do NOT replace it with a different item.',
    'You MAY restage/recompose that same product in a new professional scene (model hand, lifestyle, clean studio) as requested.',
    sellerAsk
      ? `PRIMARY creative direction from seller (must follow): ${sellerAsk}`
      : 'Place the product as the hero of a clean commercial story frame.',
    style ? `Visual style: ${style}` : null,
    'Short readable on-image text only if needed. No phone numbers, WhatsApp, Telegram, or direct contact.',
    `Product title (optional short label): ${input.listingTitle}`,
    input.priceLabel ? `Price label if shown: ${input.priceLabel}` : null,
    'Output must look like a high-end marketplace story ad for "Tabagheh", not a flat photo paste on a solid color.',
    input.systemPrompt?.trim()
      ? `Brand brief: ${input.systemPrompt.trim().slice(0, 400)}`
      : null,
    input.constraints?.trim()
      ? `Rules: ${input.constraints.trim().slice(0, 500)}`
      : null,
  ];

  return parts.filter(Boolean).join('\n');
}
