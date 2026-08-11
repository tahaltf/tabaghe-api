import {
  AI_USER_PROMPT_MAX_CHARS,
  normalizeUserPrompt,
} from './story-token-cost.util';

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

  const seller = sanitizeSellerBrief(input.userPrompt);
  const user = [
    `عنوان محصول: ${input.listingTitle}`,
    `توضیحات: ${input.listingDescription}`,
    input.priceLabel ? `قیمت: ${input.priceLabel}` : null,
    input.styleLabel ? `سبک انتخاب‌شده: ${input.styleLabel}` : null,
    seller ? `توضیحات فروشنده برای AI: ${seller}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return { system, user };
}

function shortTagline(description: string): string | null {
  const clean = String(description ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return null;
  if (clean.length <= 72) return clean;
  const cut = clean.slice(0, 72);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 32 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

type TitleParts = {
  categoryFa: string | null;
  headlineFa: string | null;
  brandLatin: string | null;
  modelLine: string | null;
  raw: string;
};

/** شکستن عنوان‌های ترکیبی فارسی/لاتین برای سلسله‌مراتب تایپوگرافی */
export function splitListingTitle(rawTitle: string): TitleParts {
  const raw = String(rawTitle ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) {
    return {
      categoryFa: null,
      headlineFa: null,
      brandLatin: null,
      modelLine: null,
      raw: '',
    };
  }

  const modelMatch = raw.match(/(?:مدل|model)\s*[:\-–]?\s*(.+)$/i);
  const modelLine = modelMatch
    ? `مدل ${modelMatch[1].replace(/^مدل\s+/i, '').trim()}`
    : null;
  const withoutModel = modelMatch
    ? raw.slice(0, modelMatch.index).replace(/[-–|]+\s*$/, '').trim()
    : raw;

  const latinBrand =
    withoutModel.match(/\b([A-Za-z][A-Za-z0-9&.'-]{1,24})\b/)?.[1] ?? null;

  const persianOnly = withoutModel
    .replace(/\b[A-Za-z][A-Za-z0-9&.'-]{1,24}\b/g, ' ')
    .replace(/[-–|,/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const knownCategories = [
    'انگشتر نقره',
    'انگشتر طلا',
    'انگشتر',
    'گردنبند',
    'دستبند',
    'گوشواره',
    'ساعت',
    'کیف',
    'کفش',
    'عطر',
    'عینک',
  ];
  let categoryFa: string | null = null;
  let headlineFa = persianOnly;
  for (const cat of knownCategories) {
    if (persianOnly.startsWith(cat)) {
      categoryFa = cat;
      headlineFa = persianOnly.slice(cat.length).trim() || persianOnly;
      break;
    }
  }
  if (!headlineFa) headlineFa = persianOnly || null;

  return {
    categoryFa,
    headlineFa,
    brandLatin: latinBrand,
    modelLine,
    raw,
  };
}

/**
 * پاکسازی brief فروشنده: حذف شماره/لینک تماس و کوتاه‌سازی امن.
 */
export function sanitizeSellerBrief(
  raw: string | null | undefined,
): string | null {
  let text = normalizeUserPrompt(raw);
  if (!text) return null;

  text = text
    .replace(
      /(?:\+98|0098|0)?9\d{9}\b/g,
      '',
    )
    .replace(
      /\b(?:https?:\/\/|www\.)\S+/gi,
      '',
    )
    .replace(
      /(?:واتس[اآ]پ|واتساپ|telegram|تلگرام|ایتا|روبیکا|شماره|تماس|call|whatsapp)\s*[:：]?\s*\S*/gi,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return null;
  if (text.length > AI_USER_PROMPT_MAX_CHARS) {
    text = text.slice(0, AI_USER_PROMPT_MAX_CHARS).trim();
  }
  return text;
}

/**
 * پرامپت تصویر سطح senior — اولویت: وفاداری محصول → brief فروشنده → صحنه → تایپوگرافی ادیتوریال.
 * انگلیسی برای مدل تصویر؛ محتوای روی تصویر فارسی/لاتین صریح.
 */
export function buildStoryImagePrompt(input: StoryGenerationInput): string {
  const sellerAsk = sanitizeSellerBrief(input.userPrompt);
  const style =
    input.stylePromptAddon?.trim() ||
    (input.styleLabel?.trim()
      ? `Visual mood: ${input.styleLabel.trim()}`
      : 'Minimal luxury editorial Instagram Story');
  const tagline = shortTagline(input.listingDescription);
  const title = splitListingTitle(input.listingTitle);

  const typeLines = [
    title.categoryFa
      ? `1) Tiny soft pill (top-left): «${title.categoryFa}»`
      : null,
    title.headlineFa
      ? `2) Large elegant Persian display headline: «${title.headlineFa}»`
      : `2) Large elegant Persian/English headline from: «${title.raw}»`,
    title.brandLatin
      ? `3) Refined Latin name under headline: «${title.brandLatin}»`
      : null,
    title.modelLine ? `4) Quiet model line: «${title.modelLine}»` : null,
    tagline
      ? `5) Short Persian benefit line (max 2 lines): «${tagline}»`
      : null,
    input.priceLabel
      ? `6) Modern price card: «${input.priceLabel}» (number dominant, تومان secondary chip)`
      : null,
    '7) Soft CTA: «هم‌اکنون در طبقه»',
    '8) Small Tabagheh mark (طبقه / TABAGHEH) in a corner — tasteful, never huge',
  ].filter(Boolean);

  const parts = [
    // ROLE + OUTCOME
    'You are an elite art director + photographer creating ONE finished Instagram Story ad (exact 9:16).',
    'Brand: Tabagheh (طبقه) — Iranian marketplace. Quality bar = luxury jewelry brand story that a real shop would post today.',
    'Output must feel designed in Figma on top of a real lifestyle photo — NOT a catalog crop with a text strip.',
    '',
    // PRIORITY
    'PRIORITY ORDER (higher wins if conflict):',
    '1) Exact product identity from the attached reference image',
    '2) Seller creative brief (staging / mood)',
    '3) Style direction',
    '4) Default Tabagheh editorial layout',
    '',
    // PRODUCT LOCK
    'PRODUCT LOCK (non-negotiable):',
    '- Attached image = the real product reference only.',
    '- Preserve exact shape, material, color, proportions, details.',
    '- Never replace, redesign, or invent a different item.',
    '- Never morph jewelry into another SKU.',
    '',
    // SCENE
    'SCENE / PHOTO (mandatory restage):',
    '- Do NOT paste/crop the source photo as the final frame.',
    '- Rebuild a premium photographic scene using that same product.',
    '- Soft beauty daylight, gentle shadows, shallow depth of field, crisp product focus.',
    '- Set: cream/white fabric folds OR airy neutral lifestyle backdrop with real texture — never flat solid dump.',
    '- Leave clean negative space on one side for typography.',
    sellerAsk
      ? `- Seller brief (must drive staging & mood): ${sellerAsk}`
      : '- Default staging: if wearable (ring/jewelry/watch/accessory), place it naturally on an elegant model hand with a refined pose.',
    '',
    // LAYOUT
    'LAYOUT BLUEPRINT:',
    '- Asymmetrical editorial composition.',
    '- Product lifestyle hero occupies roughly right / lower visual mass.',
    '- Typography stack lives in left / upper clear zone with generous whitespace.',
    '- Bottom edge: CTA + brand mark, quiet and premium.',
    '- Type must be fully inside safe margins — never clipped, never overflowing.',
    '- Integrate graphics INTO the image (editorial overlays / soft panels). Forbidden: separate peach/pink/gray FOOTER BAR glued under a photo.',
    '',
    // TYPE CONTENT
    'ON-IMAGE COPY (render elegantly, native Persian + balanced Latin):',
    ...typeLines,
    '- Type palette: deep cocoa / warm taupe / near-black on cream. Calm, expensive, minimal.',
    '',
    // STYLE
    'STYLE DIRECTION:',
    style,
    '',
    // NEGATIVES
    'HARD NEGATIVES:',
    '- Catalog thumbnail / marketplace screenshot look',
    '- Full-bleed source paste + solid footer text block',
    '- Clipped bilingual labels, meme stickers, busy collage, sparkle spam',
    '- Phone numbers, WhatsApp, Telegram, Instagram handles, QR, other brand watermarks',
    '- Fake contact CTAs (“call now”, “DM me”)',
    '',
    'SUCCESS LOOKS LIKE: one cohesive shoppable Story — lifestyle product photo + clean editorial type + price + Tabagheh presence — scroll-stopping and buyable.',
  ];

  return parts.filter((p) => p != null && String(p).length > 0).join('\n');
}
