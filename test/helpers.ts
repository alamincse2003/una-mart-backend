import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';
import { normalizeBdPhone } from './../src/common/phone.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

// E2E helpers. Tests run against the dev database and must leave it as they
// found it: every phone, product and order they create is removed again.

export async function createTestApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app: INestApplication = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

export const e164 = (phone: string) => normalizeBdPhone(phone)!;

/** Throwaway active product with one variant in the "gadgets" category. */
export async function createTestProduct(
  prisma: PrismaService,
  slug: string,
  opts: { price: number; stockQty: number },
) {
  const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'gadgets' } });
  const product = await prisma.product.create({
    data: {
      name: `E2E ${slug}`,
      slug,
      description: 'e2e',
      categoryId: category.id,
      status: 'active',
      variants: { create: { sku: `UM-${slug.toUpperCase()}`, price: opts.price, stockQty: opts.stockQty } },
    },
    include: { variants: true },
  });
  return { productId: product.id, variantId: product.variants[0].id };
}

/** Everything tied to these phones and products: orders, stock rows, audit, users, OTPs, flags. */
export async function cleanup(prisma: PrismaService, opts: { phones: string[]; productSlugs?: string[]; categorySlugs?: string[] }) {
  const phones = opts.phones.map(e164);
  const users = await prisma.user.findMany({ where: { phone: { in: phones } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  const products = await prisma.product.findMany({
    where: { slug: { in: opts.productSlugs ?? [] } },
    select: { id: true, variants: { select: { id: true } } },
  });
  const variantIds = products.flatMap((p) => p.variants.map((v) => v.id));

  const orders = await prisma.order.findMany({
    where: { OR: [{ phone: { in: phones } }, { userId: { in: userIds } }, { items: { some: { variantId: { in: variantIds } } } }] },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);
  await prisma.stockMovement.deleteMany({
    where: { OR: [{ refId: { in: orderIds } }, { variantId: { in: variantIds } }, { actorId: { in: userIds } }] },
  });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await prisma.cartItem.deleteMany({ where: { variantId: { in: variantIds } } });
  await prisma.product.deleteMany({ where: { id: { in: products.map((p) => p.id) } } });
  await prisma.category.deleteMany({ where: { slug: { in: opts.categorySlugs ?? [] } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.otpCode.deleteMany({ where: { phone: { in: phones } } });
  await prisma.phoneFlag.deleteMany({ where: { phone: { in: phones } } });
}

type Agent = ReturnType<typeof request.agent>;

export async function requestOtp(agent: Agent, phone: string, purpose: 'login' | 'checkout') {
  const res = await agent.post('/v1/auth/otp/request').send({ phone, purpose }).expect(200);
  return res.body.devCode as string;
}

/** Logs the agent in as a customer via phone OTP. */
export async function loginCustomer(agent: Agent, phone: string) {
  const code = await requestOtp(agent, phone, 'login');
  await agent.post('/v1/auth/otp/verify').send({ phone, code }).expect(200);
}

export const checkoutBody = (phone: string, overrides: Record<string, unknown> = {}) => ({
  customerName: 'E2E Buyer',
  phone,
  address: { line1: 'House 1, Road 2', area: 'Banani', city: 'Dhaka' },
  deliveryZone: 'outside_dhaka',
  paymentMethod: 'cod',
  ...overrides,
});
