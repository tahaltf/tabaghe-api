export interface DeepenFeedProduct {
  id: string;
  title: string;
  price: number;
  oldPrice: number | null;
  category: string | null;
  image: string | null;
  isAvailable: boolean;
  url: string | null;
}

export interface DeepenFeedPage {
  products: DeepenFeedProduct[];
  pageNum: number;
  pagesCount: number;
  totalItems: number;
}

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function asString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

export function parseDeepenFeedPage(raw: unknown): DeepenFeedPage {
  if (!raw || typeof raw !== 'object') {
    throw new Error('پاسخ فید نامعتبر است');
  }
  const body = raw as Record<string, unknown>;
  if (body.success === false) {
    throw new Error('فید موفق نبود (success=false)');
  }

  const productsRaw = Array.isArray(body.products) ? body.products : [];
  const products: DeepenFeedProduct[] = [];

  for (const item of productsRaw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const id = asString(row.id);
    const title = asString(row.title);
    if (!id || !title) continue;

    const oldPriceRaw = row.old_price ?? row.oldPrice;
    products.push({
      id,
      title,
      price: asNumber(row.price),
      oldPrice:
        oldPriceRaw != null && Number.isFinite(Number(oldPriceRaw))
          ? Number(oldPriceRaw)
          : null,
      category: asString(row.category),
      image: asString(row.image),
      isAvailable: row.is_available !== false && row.isAvailable !== false,
      url: asString(row.url),
    });
  }

  const pageNum = Math.max(1, Math.floor(asNumber(body.page_num) || 1));
  const pagesCount = Math.max(
    1,
    Math.floor(asNumber(body.pages_count) || pageNum),
  );
  const totalItems = Math.max(0, Math.floor(asNumber(body.total_items) || products.length));

  return { products, pageNum, pagesCount, totalItems };
}
