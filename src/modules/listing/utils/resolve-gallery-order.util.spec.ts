import { resolveGalleryFromOrder } from './resolve-gallery-order.util';

describe('resolveGalleryFromOrder', () => {
  it('merges existing names and new uploads in manifest order', () => {
    const result = resolveGalleryFromOrder(
      [
        { type: 'existing', name: 'old-b.jpg' },
        { type: 'new', fileIndex: 0 },
        { type: 'existing', name: 'old-a.jpg' },
      ],
      ['new-1.jpg'],
    );

    expect(result.gallery).toEqual(['old-b.jpg', 'new-1.jpg', 'old-a.jpg']);
    expect(result.thumbnail).toBe('old-b.jpg');
  });
});
