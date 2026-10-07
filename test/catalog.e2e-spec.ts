import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

// Runs against the seeded dev database: `npm run db:up && npm run db:seed`.
describe('Catalog (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /categories returns the tree', async () => {
    const res = await request(server()).get('/v1/categories').expect(200);
    const fashion = res.body.find((c: { slug: string }) => c.slug === 'fashion');
    expect(fashion).toBeDefined();
    expect(fashion.children.map((c: { slug: string }) => c.slug)).toContain('mens-wear');
  });

  it('GET /products paginates', async () => {
    const res = await request(server()).get('/v1/products?pageSize=5').expect(200);
    expect(res.body.items).toHaveLength(5);
    expect(res.body.total).toBeGreaterThanOrEqual(17);
    expect(res.body.totalPages).toBe(Math.ceil(res.body.total / 5));

    const page2 = await request(server()).get('/v1/products?pageSize=5&page=2').expect(200);
    const firstIds = res.body.items.map((p: { id: string }) => p.id);
    expect(page2.body.items.some((p: { id: string }) => firstIds.includes(p.id))).toBe(false);
  });

  it('category filter includes subcategories', async () => {
    const res = await request(server()).get('/v1/products?category=fashion&pageSize=100').expect(200);
    const slugs = res.body.items.map((p: { slug: string }) => p.slug);
    expect(slugs).toContain('mens-padded-winter-jacket'); // Fashion → Men's Wear → Winter
    expect(slugs).toContain('embroidered-silk-saree'); // Fashion → Women's Wear → Summer
    expect(res.body.items.every((p: { category: { slug: string } }) => p.category.slug !== 'audio')).toBe(true);
  });

  it('several categories (comma-separated) match any of them', async () => {
    const both = await request(server()).get('/v1/products?category=gadgets,sports&pageSize=100').expect(200);
    const gadgets = await request(server()).get('/v1/products?category=gadgets&pageSize=100').expect(200);
    const sports = await request(server()).get('/v1/products?category=sports&pageSize=100').expect(200);
    expect(both.body.total).toBe(gadgets.body.total + sports.body.total);
  });

  it('filters by minimum rating; list items carry variantId and stockQty', async () => {
    const res = await request(server()).get('/v1/products?rating_min=4.5&pageSize=100').expect(200);
    for (const p of res.body.items) expect(p.ratingAvg).toBeGreaterThanOrEqual(4.5);
    const item = res.body.items[0] ?? (await request(server()).get('/v1/products?pageSize=1')).body.items[0];
    expect(item.variantId).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof item.stockQty).toBe('number');
  });

  it('unknown category returns an empty page', async () => {
    const res = await request(server()).get('/v1/products?category=nope').expect(200);
    expect(res.body).toMatchObject({ items: [], total: 0 });
  });

  it('sorts by price', async () => {
    const res = await request(server()).get('/v1/products?sort=price-asc&pageSize=100').expect(200);
    const prices = res.body.items.map((p: { price: number }) => p.price);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(prices[0]).toBe(59000); // ৳590, in poisha
  });

  it('filters on sale and price range', async () => {
    const sale = await request(server()).get('/v1/products?on_sale=true&pageSize=100').expect(200);
    expect(sale.body.total).toBeGreaterThan(0);
    for (const p of sale.body.items) expect(p.compareAtPrice).toBeGreaterThan(p.price);

    const range = await request(server()).get('/v1/products?price_min=100000&price_max=200000&pageSize=100').expect(200);
    for (const p of range.body.items) {
      expect(p.price).toBeGreaterThanOrEqual(100000);
      expect(p.price).toBeLessThanOrEqual(200000);
    }
  });

  it('searches every word', async () => {
    const res = await request(server()).get('/v1/products?q=watch&pageSize=100').expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(3);
    const none = await request(server()).get('/v1/products?q=watch%20zzzz').expect(200);
    expect(none.body.total).toBe(0);
  });

  it('rejects invalid query params', async () => {
    await request(server()).get('/v1/products?sort=cheapest').expect(400);
    await request(server()).get('/v1/products?pageSize=500').expect(400);
    await request(server()).get('/v1/products?colour=red').expect(400);
  });

  it('GET /products/:slug returns variants, images and category path', async () => {
    const res = await request(server()).get('/v1/products/mens-padded-winter-jacket').expect(200);
    expect(res.body.variants).toHaveLength(1);
    expect(res.body.variants[0]).toMatchObject({ sku: 'UM-MENS-PADDED-WINTER-JACKET', price: 245000 });
    expect(res.body.images.length).toBeGreaterThan(0);
    expect(res.body.categoryPath.map((c: { slug: string }) => c.slug)).toEqual([
      'fashion',
      'mens-wear',
      'mens-winter',
    ]);
  });

  it('unknown slug is 404', async () => {
    await request(server()).get('/v1/products/does-not-exist').expect(404);
  });

  it('never exposes draft products', async () => {
    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'gadgets' } });
    const draft = await prisma.product.create({
      data: {
        name: 'E2E Draft Product',
        slug: 'e2e-draft-product',
        description: 'should stay hidden',
        categoryId: category.id,
        status: 'draft',
        variants: { create: { sku: 'UM-E2E-DRAFT', price: 1000, stockQty: 5 } },
      },
    });
    try {
      await request(server()).get('/v1/products/e2e-draft-product').expect(404);
      const list = await request(server()).get('/v1/products?q=E2E%20Draft').expect(200);
      expect(list.body.total).toBe(0);
    } finally {
      await prisma.product.delete({ where: { id: draft.id } });
    }
  });
});
