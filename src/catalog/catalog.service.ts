import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildCategoryTree, categoryPath, descendantIds } from './category-tree.js';
import type { CategoryNodeDto, ProductDetailDto, ProductListItemDto, ProductPageDto } from './dto/catalog.responses.js';
import type { ListProductsQuery, ProductSort } from './dto/list-products.query.js';

// Each product is priced by its cheapest active variant; that's what list
// filters, sorting and the card price all use.
const ORDER_BY: Record<ProductSort, Prisma.Sql> = {
  featured: Prisma.sql`(s.stock > 0) DESC, p.created_at ASC`,
  newest: Prisma.sql`p.created_at DESC`,
  'price-asc': Prisma.sql`v.price ASC`,
  'price-desc': Prisma.sql`v.price DESC`,
  rating: Prisma.sql`p.rating_avg DESC, p.rating_count DESC`,
};

const escapeLike = (term: string) => term.replace(/[\\%_]/g, (ch) => `\\${ch}`);

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  private activeCategories() {
    return this.prisma.category.findMany({
      where: { isActive: true },
      select: { id: true, name: true, slug: true, parentId: true, sortOrder: true, imageUrl: true },
    });
  }

  async getCategoryTree(): Promise<CategoryNodeDto[]> {
    return buildCategoryTree(await this.activeCategories());
  }

  async listProducts(query: ListProductsQuery): Promise<ProductPageDto> {
    const { page, pageSize } = query;
    const empty: ProductPageDto = { items: [], page, pageSize, total: 0, totalPages: 0 };

    const where: Prisma.Sql[] = [Prisma.sql`p.status = 'active'`];

    if (query.category?.length) {
      const categories = await this.activeCategories();
      const roots = categories.filter((c) => query.category!.includes(c.slug));
      if (roots.length === 0) return empty;
      const ids = [...new Set(roots.flatMap((root) => descendantIds(categories, root.id)))];
      where.push(Prisma.sql`p.category_id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})`);
    }
    if (query.ids?.length) {
      where.push(Prisma.sql`p.id IN (${Prisma.join(query.ids.map((id) => Prisma.sql`${id}::uuid`))})`);
    }
    if (query.price_min !== undefined) where.push(Prisma.sql`v.price >= ${query.price_min}`);
    if (query.price_max !== undefined) where.push(Prisma.sql`v.price <= ${query.price_max}`);
    if (query.rating_min !== undefined) where.push(Prisma.sql`p.rating_avg >= ${query.rating_min}`);
    if (query.in_stock) where.push(Prisma.sql`s.stock > 0`);
    if (query.on_sale) where.push(Prisma.sql`v.compare_at_price > v.price`);
    for (const term of (query.q ?? '').trim().split(/\s+/).filter(Boolean)) {
      const like = `%${escapeLike(term)}%`;
      where.push(
        Prisma.sql`(p.name ILIKE ${like} OR p.description ILIKE ${like} OR c.name ILIKE ${like})`,
      );
    }

    // Cheapest active variant + total active stock per product.
    const from = Prisma.sql`
      FROM product p
      JOIN category c ON c.id = p.category_id
      JOIN (
        SELECT DISTINCT ON (product_id) product_id, price, compare_at_price
        FROM product_variant WHERE is_active
        ORDER BY product_id, price ASC
      ) v ON v.product_id = p.id
      JOIN (
        SELECT product_id, SUM(stock_qty)::int AS stock
        FROM product_variant WHERE is_active
        GROUP BY product_id
      ) s ON s.product_id = p.id
      WHERE ${Prisma.join(where, ' AND ')}`;

    const [{ total }] = await this.prisma.$queryRaw<{ total: number }[]>`
      SELECT COUNT(*)::int AS total ${from}`;
    if (total === 0) return empty;

    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT p.id ${from}
      ORDER BY ${ORDER_BY[query.sort]}, p.id
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;

    const ids = rows.map((r) => r.id);
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        variants: { where: { isActive: true }, orderBy: { price: 'asc' } },
        images: { orderBy: { sortOrder: 'asc' }, take: 1 },
      },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const items = ids.flatMap((id): ProductListItemDto[] => {
      const p = byId.get(id);
      if (!p) return [];
      const cheapest = p.variants[0];
      return [
        {
          id: p.id,
          slug: p.slug,
          name: p.name,
          category: p.category,
          badge: p.badge,
          freeDelivery: p.freeDelivery,
          ratingAvg: Number(p.ratingAvg),
          ratingCount: p.ratingCount,
          image: p.images[0] ? { url: p.images[0].url, alt: p.images[0].alt } : null,
          variantId: cheapest.id,
          price: cheapest.price,
          compareAtPrice: cheapest.compareAtPrice,
          inStock: p.variants.some((v) => v.stockQty > 0),
          stockQty: p.variants.reduce((n, v) => n + v.stockQty, 0),
          variantCount: p.variants.length,
        },
      ];
    });

    return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
  }

  async getProduct(slug: string): Promise<ProductDetailDto> {
    const p = await this.prisma.product.findFirst({
      where: { slug, status: 'active', variants: { some: { isActive: true } } },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        variants: { where: { isActive: true }, orderBy: { price: 'asc' } },
        images: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!p) throw new NotFoundException('Product not found');

    const categories = await this.activeCategories();
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      brand: p.brand,
      category: p.category,
      categoryPath: categoryPath(categories, p.categoryId).map(({ id, name, slug: s }) => ({ id, name, slug: s })),
      badge: p.badge,
      freeDelivery: p.freeDelivery,
      ratingAvg: Number(p.ratingAvg),
      ratingCount: p.ratingCount,
      images: p.images.map((img) => ({ url: img.url, alt: img.alt, variantId: img.variantId })),
      variants: p.variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        options: (v.options ?? {}) as Record<string, string>,
        price: v.price,
        compareAtPrice: v.compareAtPrice,
        stockQty: v.stockQty,
        inStock: v.stockQty > 0,
      })),
      createdAt: p.createdAt.toISOString(),
    };
  }
}
