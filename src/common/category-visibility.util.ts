export type CategoryVisibilityRow = {
  id: string;
  parentId: string | null;
  isActive: boolean;
};

/** دسته و تمام اجدادش باید فعال باشند تا در سایت نمایش داده شود. */
export function isCategoryVisibleOnSite(
  id: string,
  byId: Map<string, CategoryVisibilityRow>,
): boolean {
  let cur = byId.get(id);
  if (!cur?.isActive) return false;
  while (cur?.parentId) {
    cur = byId.get(cur.parentId);
    if (!cur?.isActive) return false;
  }
  return true;
}

export function filterCategoriesVisibleOnSite<
  T extends CategoryVisibilityRow,
>(rows: T[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return rows.filter((r) => isCategoryVisibleOnSite(r.id, byId));
}
