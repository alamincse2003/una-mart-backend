// Pure helpers over the (small) category list, so tree logic is unit-testable
// without a database.

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  sortOrder: number;
  imageUrl: string | null;
}

export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  children: CategoryNode[];
}

const bySortThenName = (a: CategoryRow, b: CategoryRow) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

/** Nested tree from flat rows. Rows whose parent isn't in the list are dropped. */
export function buildCategoryTree(rows: CategoryRow[]): CategoryNode[] {
  const childrenOf = new Map<string | null, CategoryRow[]>();
  for (const row of rows) {
    const list = childrenOf.get(row.parentId) ?? [];
    list.push(row);
    childrenOf.set(row.parentId, list);
  }
  const build = (parentId: string | null): CategoryNode[] =>
    (childrenOf.get(parentId) ?? []).sort(bySortThenName).map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      imageUrl: row.imageUrl,
      children: build(row.id),
    }));
  return build(null);
}

/** The category itself plus every descendant, at any depth. */
export function descendantIds(rows: Pick<CategoryRow, 'id' | 'parentId'>[], rootId: string): string[] {
  const result = new Set([rootId]);
  let added = true;
  while (added) {
    added = false;
    for (const row of rows) {
      if (row.parentId && result.has(row.parentId) && !result.has(row.id)) {
        result.add(row.id);
        added = true;
      }
    }
  }
  return [...result];
}

/** Moving `id` under `newParentId` would put it inside its own subtree. */
export function wouldCreateCycle(
  rows: Pick<CategoryRow, 'id' | 'parentId'>[],
  id: string,
  newParentId: string | null,
): boolean {
  return newParentId !== null && descendantIds(rows, id).includes(newParentId);
}

/** Root-first ancestor chain, e.g. Fashion → Men's Wear → Summer. */
export function categoryPath<T extends Pick<CategoryRow, 'id' | 'parentId'>>(rows: T[], id: string): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const path: T[] = [];
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}
