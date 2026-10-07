import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { conflict, notFound, unprocessable } from '../common/app-error.js';
import { pageOf, skipTake } from '../common/page.query.js';
import { wouldCreateCycle } from '../catalog/category-tree.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from './audit.service.js';
import type {
  AdminCategoryDto,
  AdminProductDto,
  AdminProductPageDto,
  AdminProductsQuery,
  CreateCategoryDto,
  CreateProductDto,
  StockAdjustDto,
  StockAdjustResultDto,
  UpdateCategoryDto,
  UpdateProductDto,
  UpdateVariantDto,
  VariantInputDto,
} from './dto/admin-catalog.dto.js';

const productInclude = {
  category: { select: { id: true, name: true, slug: true } },
  variants: { orderBy: { price: 'asc' as const } },
  images: { orderBy: { sortOrder: 'asc' as const } },
} satisfies Prisma.ProductInclude;

type ProductFull = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

export function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 150);
}

function checkOptions(options: Record<string, unknown> | undefined) {
  if (!options) return;
  const entries = Object.entries(options);
  const ok =
    entries.length <= 5 &&
    entries.every(([k, v]) => k.length > 0 && k.length <= 30 && typeof v === 'string' && v.length > 0 && v.length <= 40);
  if (!ok) throw unprocessable('INVALID_OPTIONS', 'Options must be up to 5 text pairs, e.g. { "size": "M" }.');
}

function checkPrice(price: number, compareAtPrice: number | null) {
  if (compareAtPrice !== null && compareAtPrice <= price) {
    throw unprocessable('INVALID_PRICE', 'The original (was) price must be higher than the selling price.');
  }
}

// Products, variants, stock and categories for the admin panel. Every write
// is audited in the same transaction. Stock goes through InventoryService.
@Injectable()
export class AdminCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- products

  async listProducts(query: AdminProductsQuery): Promise<AdminProductPageDto> {
    const q = query.q?.trim();
    const where: Prisma.ProductWhereInput = {
      ...(query.status ? { status: query.status as ProductFull['status'] } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { variants: { some: { sku: { contains: q.toUpperCase() } } } },
            ],
          }
        : {}),
    };
    const [total, products] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({ where, include: productInclude, orderBy: { updatedAt: 'desc' }, ...skipTake(query) }),
    ]);
    return pageOf(
      products.map((p) => {
        const active = p.variants.filter((v) => v.isActive);
        return {
          id: p.id,
          slug: p.slug,
          name: p.name,
          status: p.status,
          badge: p.badge,
          category: p.category,
          price: active[0]?.price ?? null,
          compareAtPrice: active[0]?.compareAtPrice ?? null,
          stockTotal: active.reduce((n, v) => n + v.stockQty, 0),
          variantCount: p.variants.length,
          imageUrl: p.images[0]?.url ?? null,
          updatedAt: p.updatedAt.toISOString(),
        };
      }),
      total,
      query,
    );
  }

  async getProduct(id: string): Promise<AdminProductDto> {
    const product = await this.prisma.product.findUnique({ where: { id }, include: productInclude });
    if (!product) throw notFound('Product not found');
    return toProduct(product);
  }

  async createProduct(input: CreateProductDto, actorId: string): Promise<AdminProductDto> {
    const slug = input.slug ?? slugify(input.name);
    if (!slug) throw unprocessable('INVALID_SLUG', 'Please give the product a slug.');
    await this.assertCategory(input.categoryId);
    await this.assertSlugFree(slug);
    await this.assertSkuFree(input.variant.sku);
    checkOptions(input.variant.options);
    checkPrice(input.variant.price, input.variant.compareAtPrice ?? null);

    const id = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          name: input.name.trim(),
          slug,
          description: input.description.trim(),
          categoryId: input.categoryId,
          brand: input.brand?.trim() || null,
          status: input.status ?? 'draft',
          badge: input.badge ?? null,
          freeDelivery: input.freeDelivery ?? false,
          images: { create: (input.images ?? []).map((url, i) => ({ url, alt: input.name.trim(), sortOrder: i })) },
        },
      });
      await this.addVariant(tx, product.id, input.variant, actorId);
      await this.audit.log(tx, actorId, {
        action: 'product.create',
        entityType: 'product',
        entityId: product.id,
        after: { ...input },
      });
      return product.id;
    });
    return this.getProduct(id);
  }

  async updateProduct(id: string, input: UpdateProductDto, actorId: string): Promise<AdminProductDto> {
    const before = await this.prisma.product.findUnique({ where: { id }, include: productInclude });
    if (!before) throw notFound('Product not found');
    if (input.slug && input.slug !== before.slug) await this.assertSlugFree(input.slug);
    if (input.categoryId && input.categoryId !== before.categoryId) await this.assertCategory(input.categoryId);
    if (input.status === 'active' && !before.variants.some((v) => v.isActive)) {
      throw unprocessable('NO_ACTIVE_VARIANT', 'Add or activate a variant before publishing.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          ...(input.name != null ? { name: input.name.trim() } : {}),
          ...(input.slug != null ? { slug: input.slug } : {}),
          ...(input.description != null ? { description: input.description.trim() } : {}),
          ...(input.categoryId != null ? { categoryId: input.categoryId } : {}),
          ...(input.brand !== undefined ? { brand: input.brand?.trim() || null } : {}),
          ...(input.status != null ? { status: input.status } : {}),
          ...(input.badge !== undefined ? { badge: input.badge } : {}),
          ...(input.freeDelivery != null ? { freeDelivery: input.freeDelivery } : {}),
        },
      });
      if (input.images) {
        await tx.productImage.deleteMany({ where: { productId: id } });
        await tx.productImage.createMany({
          data: input.images.map((url, i) => ({ productId: id, url, alt: input.name ?? before.name, sortOrder: i })),
        });
      }
      await this.audit.log(tx, actorId, {
        action: 'product.update',
        entityType: 'product',
        entityId: id,
        before: toProduct(before),
        after: { ...input },
      });
    });
    return this.getProduct(id);
  }

  // ---------------------------------------------------------------- variants

  async createVariant(productId: string, input: VariantInputDto, actorId: string): Promise<AdminProductDto> {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
    if (!product) throw notFound('Product not found');
    await this.assertSkuFree(input.sku);
    checkOptions(input.options);
    checkPrice(input.price, input.compareAtPrice ?? null);
    await this.prisma.$transaction(async (tx) => {
      const variant = await this.addVariant(tx, productId, input, actorId);
      await this.audit.log(tx, actorId, {
        action: 'variant.create',
        entityType: 'variant',
        entityId: variant.id,
        after: { ...input, productId },
      });
    });
    return this.getProduct(productId);
  }

  /** Price, SKU, options, on/off. Never stock — that's adjustStock. */
  async updateVariant(variantId: string, input: UpdateVariantDto, actorId: string): Promise<AdminProductDto> {
    const before = await this.prisma.productVariant.findUnique({ where: { id: variantId } });
    if (!before) throw notFound('Variant not found');
    if (input.sku && input.sku !== before.sku) await this.assertSkuFree(input.sku);
    checkOptions(input.options);
    const price = input.price ?? before.price;
    const compareAtPrice = input.compareAtPrice !== undefined ? input.compareAtPrice : before.compareAtPrice;
    checkPrice(price, compareAtPrice);

    await this.prisma.$transaction(async (tx) => {
      const after = await tx.productVariant.update({
        where: { id: variantId },
        data: {
          ...(input.sku != null ? { sku: input.sku } : {}),
          ...(input.options != null ? { options: input.options } : {}),
          price,
          compareAtPrice,
          ...(input.isActive != null ? { isActive: input.isActive } : {}),
        },
      });
      await this.audit.log(tx, actorId, {
        action: 'variant.update',
        entityType: 'variant',
        entityId: variantId,
        before,
        after,
      });
    });
    return this.getProduct(before.productId);
  }

  async adjustStock(variantId: string, input: StockAdjustDto, actorId: string): Promise<StockAdjustResultDto> {
    const stockQty = await this.prisma.$transaction(async (tx) => {
      const before = await tx.productVariant.findUnique({ where: { id: variantId }, select: { stockQty: true } });
      if (!before) throw notFound('Variant not found');
      const after = await this.inventory.adjust(tx, variantId, input.delta, input.reason, {
        refType: 'admin',
        refId: actorId,
        actorId,
      });
      await this.audit.log(tx, actorId, {
        action: 'variant.stock',
        entityType: 'variant',
        entityId: variantId,
        before: { stockQty: before.stockQty },
        after: { stockQty: after, delta: input.delta, reason: input.reason, note: input.note ?? null },
      });
      return after;
    });
    return { variantId, stockQty };
  }

  // -------------------------------------------------------------- categories

  async listCategories(): Promise<AdminCategoryDto[]> {
    const rows = await this.prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { products: true } } },
    });
    return rows.map(({ _count, ...c }) => ({ ...c, productCount: _count.products }));
  }

  async createCategory(input: CreateCategoryDto, actorId: string): Promise<AdminCategoryDto> {
    await this.assertCategorySlugFree(input.slug);
    if (input.parentId) await this.assertCategory(input.parentId);
    const id = await this.prisma.$transaction(async (tx) => {
      const category = await tx.category.create({
        data: {
          name: input.name.trim(),
          slug: input.slug,
          parentId: input.parentId ?? null,
          sortOrder: input.sortOrder ?? 0,
          imageUrl: input.imageUrl ?? null,
          isActive: input.isActive ?? true,
        },
      });
      await this.audit.log(tx, actorId, {
        action: 'category.create',
        entityType: 'category',
        entityId: category.id,
        after: category,
      });
      return category.id;
    });
    return this.categoryById(id);
  }

  async updateCategory(id: string, input: UpdateCategoryDto, actorId: string): Promise<AdminCategoryDto> {
    const rows = await this.prisma.category.findMany({ select: { id: true, parentId: true, slug: true } });
    const before = await this.prisma.category.findUnique({ where: { id } });
    if (!before) throw notFound('Category not found');
    if (input.slug && input.slug !== before.slug) await this.assertCategorySlugFree(input.slug);
    if (input.parentId !== undefined) {
      if (input.parentId !== null && !rows.some((r) => r.id === input.parentId)) {
        throw unprocessable('INVALID_CATEGORY', 'That parent category does not exist.');
      }
      if (input.parentId === id || wouldCreateCycle(rows, id, input.parentId)) {
        throw unprocessable('CATEGORY_CYCLE', "A category can't be moved inside itself or its own subcategory.");
      }
    }
    await this.prisma.$transaction(async (tx) => {
      const after = await tx.category.update({
        where: { id },
        data: {
          ...(input.name != null ? { name: input.name.trim() } : {}),
          ...(input.slug != null ? { slug: input.slug } : {}),
          ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
          ...(input.sortOrder != null ? { sortOrder: input.sortOrder } : {}),
          ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
          ...(input.isActive != null ? { isActive: input.isActive } : {}),
        },
      });
      await this.audit.log(tx, actorId, { action: 'category.update', entityType: 'category', entityId: id, before, after });
    });
    return this.categoryById(id);
  }

  // ----------------------------------------------------------------- helpers

  /** Creates the variant with 0 stock, then books opening stock as a restock (ledger stays complete). */
  private async addVariant(tx: Prisma.TransactionClient, productId: string, input: VariantInputDto, actorId: string) {
    const variant = await tx.productVariant.create({
      data: {
        productId,
        sku: input.sku,
        options: input.options ?? {},
        price: input.price,
        compareAtPrice: input.compareAtPrice ?? null,
        stockQty: 0,
      },
    });
    if (input.stockQty) {
      await this.inventory.adjust(tx, variant.id, input.stockQty, 'restock', { refType: 'admin', refId: actorId, actorId });
    }
    return variant;
  }

  private async categoryById(id: string) {
    const c = await this.prisma.category.findUniqueOrThrow({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    const { _count, ...rest } = c;
    return { ...rest, productCount: _count.products };
  }

  private async assertCategory(id: string) {
    const exists = await this.prisma.category.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw unprocessable('INVALID_CATEGORY', 'That category does not exist.');
  }

  private async assertSlugFree(slug: string) {
    if (await this.prisma.product.findUnique({ where: { slug }, select: { id: true } })) {
      throw conflict('SLUG_TAKEN', `Another product already uses the slug "${slug}".`);
    }
  }

  private async assertCategorySlugFree(slug: string) {
    if (await this.prisma.category.findUnique({ where: { slug }, select: { id: true } })) {
      throw conflict('SLUG_TAKEN', `Another category already uses the slug "${slug}".`);
    }
  }

  private async assertSkuFree(sku: string) {
    if (await this.prisma.productVariant.findUnique({ where: { sku }, select: { id: true } })) {
      throw conflict('SKU_TAKEN', `SKU ${sku} is already used.`);
    }
  }
}

function toProduct(p: ProductFull): AdminProductDto {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    brand: p.brand,
    status: p.status,
    badge: p.badge,
    freeDelivery: p.freeDelivery,
    category: p.category,
    images: p.images.map((img) => ({ id: img.id, url: img.url, alt: img.alt, sortOrder: img.sortOrder })),
    variants: p.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      options: (v.options ?? {}) as Record<string, string>,
      price: v.price,
      compareAtPrice: v.compareAtPrice,
      stockQty: v.stockQty,
      isActive: v.isActive,
    })),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}
