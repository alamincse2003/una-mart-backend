// Loads the storefront's Phase 1 catalog into the database.
//
// prisma/seed-data.json is a snapshot of una-mart-frontend/lib/fake-data.ts
// (categories + products). Idempotent: re-running updates rows in place
// (matched by slug / sku), so `npm run db:seed` is always safe.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

interface SeedCategory {
  name: string;
  slug: string;
  parentSlug: string | null;
  sortOrder: number;
}

interface SeedProduct {
  name: string;
  slug: string;
  description: string;
  categorySlug: string;
  status: string;
  badge: 'new' | 'sale' | 'best' | null;
  freeDelivery: boolean;
  priceBdt: number;
  originalPriceBdt: number | null;
  stockQty: number;
  images: string[];
  rating: number;
  reviewCount: number;
  createdAt: string;
}

const data = JSON.parse(readFileSync(new URL('./seed-data.json', import.meta.url), 'utf8')) as {
  categories: SeedCategory[];
  products: SeedProduct[];
};

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const toPoisha = (bdt: number) => Math.round(bdt * 100);

async function seedCategories() {
  const idBySlug = new Map<string, string>();
  // Parents before children, whatever order the snapshot is in.
  const pending = [...data.categories];
  while (pending.length > 0) {
    const index = pending.findIndex((c) => !c.parentSlug || idBySlug.has(c.parentSlug));
    if (index === -1) throw new Error('Category tree has a missing parent or a cycle');
    const [c] = pending.splice(index, 1);
    const fields = {
      name: c.name,
      sortOrder: c.sortOrder,
      parentId: c.parentSlug ? idBySlug.get(c.parentSlug)! : null,
    };
    const row = await prisma.category.upsert({
      where: { slug: c.slug },
      create: { slug: c.slug, ...fields },
      update: fields,
    });
    idBySlug.set(c.slug, row.id);
  }
  return idBySlug;
}

async function seedProducts(categoryIdBySlug: Map<string, string>) {
  for (const p of data.products) {
    const categoryId = categoryIdBySlug.get(p.categorySlug);
    if (!categoryId) throw new Error(`Unknown category "${p.categorySlug}" for ${p.slug}`);

    const fields = {
      name: p.name,
      description: p.description,
      categoryId,
      // Phase 1 "out_of_stock" is not a product status any more — stock
      // lives on the variant, so such products are active with stock 0.
      status: p.status === 'draft' ? ('draft' as const) : ('active' as const),
      badge: p.badge,
      freeDelivery: p.freeDelivery,
      ratingAvg: p.rating,
      ratingCount: p.reviewCount,
    };
    const product = await prisma.product.upsert({
      where: { slug: p.slug },
      create: { slug: p.slug, createdAt: new Date(p.createdAt), ...fields },
      update: fields,
    });

    const price = toPoisha(p.priceBdt);
    const compareAt =
      p.originalPriceBdt && p.originalPriceBdt > p.priceBdt ? toPoisha(p.originalPriceBdt) : null;
    const variant = {
      price,
      compareAtPrice: compareAt,
      stockQty: p.status === 'out_of_stock' ? 0 : p.stockQty,
      isActive: true,
    };
    await prisma.productVariant.upsert({
      where: { sku: `UM-${p.slug.toUpperCase()}` },
      create: { sku: `UM-${p.slug.toUpperCase()}`, productId: product.id, options: {}, ...variant },
      update: variant,
    });

    await prisma.productImage.deleteMany({ where: { productId: product.id } });
    await prisma.productImage.createMany({
      data: p.images.map((url, sortOrder) => ({ productId: product.id, url, alt: p.name, sortOrder })),
    });
  }
}

// Same fees as the storefront's lib/pricing.ts.
const DELIVERY_ZONES = [
  { code: 'inside_dhaka', name: 'Inside Dhaka', fee: 0, etaText: '1–2 business days', sortOrder: 0 },
  { code: 'outside_dhaka', name: 'Outside Dhaka', fee: toPoisha(120), etaText: '3–5 business days', sortOrder: 1 },
];

async function seedDeliveryZones() {
  for (const { code, ...fields } of DELIVERY_ZONES) {
    await prisma.deliveryZone.upsert({ where: { code }, create: { code, ...fields }, update: fields });
  }
}

async function main() {
  const categoryIds = await seedCategories();
  await seedProducts(categoryIds);
  await seedDeliveryZones();
  const [categories, products, variants] = await Promise.all([
    prisma.category.count(),
    prisma.product.count(),
    prisma.productVariant.count(),
  ]);
  console.log(`Seeded: ${categories} categories, ${products} products, ${variants} variants`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
