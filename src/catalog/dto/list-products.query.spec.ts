import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ListProductsQuery } from './list-products.query.js';

function parse(raw: Record<string, string>) {
  const query = plainToInstance(ListProductsQuery, raw);
  const errors = validateSync(query, { whitelist: true, forbidNonWhitelisted: true });
  return { query, invalid: errors.map((e) => e.property) };
}

describe('ListProductsQuery', () => {
  it('applies defaults', () => {
    const { query, invalid } = parse({});
    expect(invalid).toEqual([]);
    expect(query).toMatchObject({ sort: 'featured', page: 1, pageSize: 24 });
  });

  it('coerces numbers, booleans and id lists from the query string', () => {
    const id = '0b1e8d2c-6a3f-4f5e-9a3b-2c1d0e9f8a7b';
    const { query, invalid } = parse({
      price_min: '50000',
      in_stock: 'true',
      on_sale: 'false',
      ids: `${id}, ${id}`,
      page: '2',
    });
    expect(invalid).toEqual([]);
    expect(query).toMatchObject({ price_min: 50000, in_stock: true, on_sale: false, page: 2, ids: [id, id] });
  });

  it('rejects bad input', () => {
    expect(parse({ sort: 'cheapest' }).invalid).toContain('sort');
    expect(parse({ pageSize: '500' }).invalid).toContain('pageSize');
    expect(parse({ page: '0' }).invalid).toContain('page');
    expect(parse({ ids: 'prod-1' }).invalid).toContain('ids');
    expect(parse({ price_min: '-1' }).invalid).toContain('price_min');
  });
});
