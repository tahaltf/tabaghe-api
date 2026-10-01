import { parseDeepenFeedPage } from './deepen-feed.parser';

describe('parseDeepenFeedPage stock', () => {
  it('reads numeric stock_quantity', () => {
    const page = parseDeepenFeedPage({
      success: true,
      products: [
        {
          id: '1',
          title: 'A',
          price: 100,
          stock_quantity: 3,
          is_available: true,
        },
      ],
      page_num: 1,
      pages_count: 1,
      total_items: 1,
    });
    expect(page.products[0].stockQuantity).toBe(3);
  });

  it('falls back to 1/0 from is_available', () => {
    const page = parseDeepenFeedPage({
      success: true,
      products: [
        { id: '1', title: 'A', price: 100, is_available: true },
        { id: '2', title: 'B', price: 100, is_available: false },
      ],
      page_num: 1,
      pages_count: 1,
      total_items: 2,
    });
    expect(page.products[0].stockQuantity).toBe(1);
    expect(page.products[1].stockQuantity).toBe(0);
  });
});
