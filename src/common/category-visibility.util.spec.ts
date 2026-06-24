import {
  filterCategoriesSelectableForListing,
  isCategorySelectableForListing,
  isCategoryVisibleOnSite,
} from './category-visibility.util';

describe('category visibility', () => {
  const rows = [
    { id: 'root', parentId: null, isActive: true },
    { id: 'parent', parentId: 'root', isActive: true },
    { id: 'leaf', parentId: 'parent', isActive: true },
    { id: 'inactive', parentId: 'root', isActive: false },
  ];

  it('marks parents with active children as not selectable', () => {
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(isCategorySelectableForListing('root', byId)).toBe(false);
    expect(isCategorySelectableForListing('parent', byId)).toBe(false);
    expect(isCategorySelectableForListing('leaf', byId)).toBe(true);
  });

  it('allows parent without active children when only inactive children exist', () => {
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(isCategoryVisibleOnSite('inactive', byId)).toBe(false);
    expect(isCategorySelectableForListing('root', byId)).toBe(false);
  });

  it('filters selectable categories from rows', () => {
    const selectable = filterCategoriesSelectableForListing(rows);
    expect(selectable.map((row) => row.id)).toEqual(['leaf']);
  });
});
