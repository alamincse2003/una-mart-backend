import { wouldCreateCycle } from '../catalog/category-tree.js';
import { slugify } from './admin-catalog.service.js';
import { startOfDhakaDay } from './admin-settings.service.js';

describe('wouldCreateCycle', () => {
  const rows = [
    { id: 'fashion', parentId: null },
    { id: 'mens', parentId: 'fashion' },
    { id: 'mens-summer', parentId: 'mens' },
    { id: 'gadgets', parentId: null },
  ];

  it('rejects moving a category under its own descendant', () => {
    expect(wouldCreateCycle(rows, 'fashion', 'mens-summer')).toBe(true);
    expect(wouldCreateCycle(rows, 'fashion', 'mens')).toBe(true);
  });

  it('allows moves elsewhere and to the top level', () => {
    expect(wouldCreateCycle(rows, 'mens', 'gadgets')).toBe(false);
    expect(wouldCreateCycle(rows, 'mens', null)).toBe(false);
  });
});

describe('slugify', () => {
  it('makes lowercase dash-joined slugs', () => {
    expect(slugify("Men's Linen Shirt — Navy")).toBe('men-s-linen-shirt-navy');
    expect(slugify('  ১২৩ ')).toBe('');
  });
});

describe('startOfDhakaDay', () => {
  it('uses midnight in Dhaka (UTC+6)', () => {
    // 2026-10-07 20:00 UTC = 2026-10-08 02:00 in Dhaka.
    expect(startOfDhakaDay(new Date('2026-10-07T20:00:00Z')).toISOString()).toBe('2026-10-07T18:00:00.000Z');
    // 2026-10-07 10:00 UTC = 16:00 in Dhaka, same day.
    expect(startOfDhakaDay(new Date('2026-10-07T10:00:00Z')).toISOString()).toBe('2026-10-06T18:00:00.000Z');
  });
});
