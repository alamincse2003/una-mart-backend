import { buildCategoryTree, categoryPath, descendantIds, type CategoryRow } from './category-tree.js';

const row = (id: string, parentId: string | null, sortOrder = 0): CategoryRow => ({
  id,
  name: id,
  slug: id,
  parentId,
  sortOrder,
  imageUrl: null,
});

const rows: CategoryRow[] = [
  row('fashion', null, 0),
  row('gadgets', null, 1),
  row('mens', 'fashion', 0),
  row('mens-summer', 'mens', 0),
  row('womens', 'fashion', 1),
  row('audio', 'gadgets', 0),
];

describe('category tree helpers', () => {
  it('builds a nested, ordered tree', () => {
    const tree = buildCategoryTree(rows);
    expect(tree.map((n) => n.slug)).toEqual(['fashion', 'gadgets']);
    expect(tree[0].children.map((n) => n.slug)).toEqual(['mens', 'womens']);
    expect(tree[0].children[0].children[0].slug).toBe('mens-summer');
  });

  it('drops children whose parent is missing (e.g. inactive)', () => {
    const tree = buildCategoryTree(rows.filter((r) => r.id !== 'mens'));
    expect(tree[0].children.map((n) => n.slug)).toEqual(['womens']);
  });

  it('collects every descendant at any depth', () => {
    expect(descendantIds(rows, 'fashion').sort()).toEqual(['fashion', 'mens', 'mens-summer', 'womens']);
    expect(descendantIds(rows, 'audio')).toEqual(['audio']);
  });

  it('returns the root-first path', () => {
    expect(categoryPath(rows, 'mens-summer').map((r) => r.id)).toEqual(['fashion', 'mens', 'mens-summer']);
  });
});
