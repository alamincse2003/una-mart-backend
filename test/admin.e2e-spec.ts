import type { INestApplication } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import type { PrismaService } from './../src/prisma/prisma.service.js';
import { checkoutBody, cleanup, createTestApp, e164, loginCustomer } from './helpers.js';

const ADMIN_PHONE = '01300000201';
const CUSTOMER_PHONE = '01300000202';
const PASSWORD = 'correct horse battery staple';
const PRODUCT_SLUG = 'e2e-admin-product';
const CATEGORY_SLUG = 'e2e-admin-category';

describe('Admin API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: ReturnType<typeof request.agent>;
  let variantId = '';
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    const opts = { phones: [ADMIN_PHONE, CUSTOMER_PHONE], productSlugs: [PRODUCT_SLUG], categorySlugs: [CATEGORY_SLUG] };
    await cleanup(prisma, opts);
    await prisma.user.create({
      data: { phone: e164(ADMIN_PHONE), name: 'E2E Admin', role: 'admin', passwordHash: await hash(PASSWORD) },
    });
  });

  afterAll(async () => {
    await cleanup(prisma, {
      phones: [ADMIN_PHONE, CUSTOMER_PHONE],
      productSlugs: [PRODUCT_SLUG],
      categorySlugs: [CATEGORY_SLUG],
    });
    await app.close();
  });

  it('no session → 401; customer → 403; admin via customer OTP login → still 403', async () => {
    await request(server()).get('/v1/admin/stats').expect(401);

    const customer = request.agent(server());
    await loginCustomer(customer, CUSTOMER_PHONE);
    const forbidden = await customer.get('/v1/admin/stats').expect(403);
    expect(forbidden.body.code).toBe('FORBIDDEN');

    // Admin role but a customer session (no password step) must not pass.
    const sneaky = request.agent(server());
    await loginCustomer(sneaky, ADMIN_PHONE);
    await sneaky.get('/v1/admin/stats').expect(403);
  });

  it('admin login needs password AND OTP', async () => {
    const bad = await request(server())
      .post('/v1/auth/admin/login')
      .send({ phone: ADMIN_PHONE, password: 'wrong password!!' })
      .expect(401);
    expect(bad.body.code).toBe('INVALID_CREDENTIALS');
    const unknown = await request(server())
      .post('/v1/auth/admin/login')
      .send({ phone: CUSTOMER_PHONE, password: PASSWORD })
      .expect(401);
    expect(unknown.body).toEqual(bad.body); // same answer: no account probing

    admin = request.agent(server());
    const step1 = await admin.post('/v1/auth/admin/login').send({ phone: ADMIN_PHONE, password: PASSWORD }).expect(200);
    expect(step1.body.devCode).toMatch(/^\d{6}$/);
    const step2 = await admin
      .post('/v1/auth/admin/verify')
      .send({ phone: ADMIN_PHONE, code: step1.body.devCode })
      .expect(200);
    expect(step2.body).toMatchObject({ role: 'admin', scope: 'admin' });

    const stats = await admin.get('/v1/admin/stats').expect(200);
    expect(stats.body).toMatchObject({ lowStockThreshold: 5 });
    expect(typeof stats.body.ordersToday).toBe('number');
  });

  it('refuses cookie-carrying writes from a foreign origin', async () => {
    const res = await admin
      .post('/v1/admin/categories')
      .set('Origin', 'https://evil.example')
      .send({ name: 'Nope', slug: 'nope' })
      .expect(403);
    expect(res.body.code).toBe('BAD_ORIGIN');
  });

  it('products: create with opening stock, price rules, stock adjust ledger, audit', async () => {
    const gadgets = await prisma.category.findUniqueOrThrow({ where: { slug: 'gadgets' } });
    const created = await admin
      .post('/v1/admin/products')
      .send({
        name: 'E2E Admin Product',
        slug: PRODUCT_SLUG,
        description: 'Made by the admin e2e test',
        categoryId: gadgets.id,
        status: 'active',
        images: ['/images/e2e.jpg'],
        variant: { sku: 'UM-E2E-ADMIN-1', price: 40000, stockQty: 5 },
      })
      .expect(201);
    expect(created.body.variants).toEqual([expect.objectContaining({ sku: 'UM-E2E-ADMIN-1', stockQty: 5 })]);
    variantId = created.body.variants[0].id;
    expect(await prisma.stockMovement.findMany({ where: { variantId }, select: { delta: true, reason: true } })).toEqual([
      { delta: 5, reason: 'restock' },
    ]);

    const dupe = await admin
      .post('/v1/admin/products')
      .send({ name: 'Dupe', slug: PRODUCT_SLUG, description: 'x', categoryId: gadgets.id, variant: { sku: 'UM-E2E-ADMIN-2', price: 100 } })
      .expect(409);
    expect(dupe.body.code).toBe('SLUG_TAKEN');

    const badPrice = await admin.patch(`/v1/admin/variants/${variantId}`).send({ compareAtPrice: 30000 }).expect(422);
    expect(badPrice.body.code).toBe('INVALID_PRICE');
    const sale = await admin.patch(`/v1/admin/variants/${variantId}`).send({ compareAtPrice: 50000 }).expect(200);
    expect(sale.body.variants[0].compareAtPrice).toBe(50000);

    // Stock isn't editable through the variant PATCH.
    await admin.patch(`/v1/admin/variants/${variantId}`).send({ stockQty: 999 }).expect(400);

    const tooMany = await admin.post(`/v1/admin/variants/${variantId}/stock`).send({ delta: -10, reason: 'adjustment' }).expect(409);
    expect(tooMany.body.code).toBe('STOCK_NEGATIVE');
    const restocked = await admin
      .post(`/v1/admin/variants/${variantId}/stock`)
      .send({ delta: 3, reason: 'restock', note: 'Supplier delivery' })
      .expect(200);
    expect(restocked.body).toEqual({ variantId, stockQty: 8 });

    const audit = await admin.get(`/v1/admin/audit-log?entityType=variant&entityId=${variantId}`).expect(200);
    expect(audit.body.items.map((e: { action: string }) => e.action)).toEqual(['variant.stock', 'variant.update']);
    expect(audit.body.items[0].actor.phone).toBe(e164(ADMIN_PHONE));

    const list = await admin.get(`/v1/admin/products?q=${PRODUCT_SLUG.replace(/-/g, ' ').slice(0, 14)}`).expect(200);
    expect(list.body.items.some((p: { slug: string }) => p.slug === PRODUCT_SLUG)).toBe(true);
  });

  it('orders: lifecycle via transition, COD paid on delivery, refusals counted, restock on return', async () => {
    // Admin's own verified phone → no OTP, auto-confirmed.
    const placeOrder = async () => {
      await admin.post('/v1/cart/items').send({ variantId, quantity: 1 }).expect(201);
      const res = await admin.post('/v1/orders').send(checkoutBody(ADMIN_PHONE)).expect(201);
      expect(res.body.status).toBe('confirmed');
      return res.body.orderNumber as string;
    };
    const move = (orderNumber: string, to: string, expected = 200) =>
      admin.post(`/v1/admin/orders/${orderNumber}/transition`).send({ to }).expect(expected);

    const delivered = await placeOrder();
    for (const to of ['processing', 'shipped']) await move(delivered, to);
    const done = await move(delivered, 'delivered');
    expect(done.body).toMatchObject({ status: 'delivered', paymentStatus: 'paid', allowedTransitions: [] });
    expect(done.body.payments[0].status).toBe('succeeded');
    expect(done.body.timeline.at(-1)).toMatchObject({ toStatus: 'delivered', actorType: 'admin', actorName: 'E2E Admin' });
    const invalid = await move(delivered, 'cancelled', 409);
    expect(invalid.body.code).toBe('INVALID_TRANSITION');

    const refused = await placeOrder();
    for (const to of ['processing', 'shipped', 'delivery_failed']) await move(refused, to);
    const back = await move(refused, 'returned_to_warehouse');
    expect(back.body.phoneFlag).toMatchObject({ codRefusedCount: 1, codDeliveredCount: 1 });
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stockQty).toBe(7); // 8 − 1 delivered

    const noted = await admin.patch(`/v1/admin/orders/${refused}`).send({ adminNote: 'Customer not reachable' }).expect(200);
    expect(noted.body.adminNote).toBe('Customer not reachable');

    const list = await admin.get(`/v1/admin/orders?q=${ADMIN_PHONE}&status=delivered`).expect(200);
    expect(list.body.items.map((o: { orderNumber: string }) => o.orderNumber)).toEqual([delivered]);
  });

  it('categories: create, and no moving a category inside itself', async () => {
    const fashion = await prisma.category.findUniqueOrThrow({ where: { slug: 'fashion' } });
    const child = await admin
      .post('/v1/admin/categories')
      .send({ name: 'E2E Child', slug: CATEGORY_SLUG, parentId: fashion.id, isActive: false })
      .expect(201);
    const cycle = await admin.patch(`/v1/admin/categories/${fashion.id}`).send({ parentId: child.body.id }).expect(422);
    expect(cycle.body.code).toBe('CATEGORY_CYCLE');
    // Hidden categories stay out of the storefront tree.
    const tree = await request(server()).get('/v1/categories').expect(200);
    expect(JSON.stringify(tree.body)).not.toContain(CATEGORY_SLUG);
  });

  it('phone flags: block a phone; delivery zone edits are audited', async () => {
    const blocked = await admin
      .patch(`/v1/admin/phone-flags/${CUSTOMER_PHONE}`)
      .send({ isBlocked: true, note: 'Fake orders' })
      .expect(200);
    expect(blocked.body).toMatchObject({ phone: e164(CUSTOMER_PHONE), isBlocked: true });
    const listed = await admin.get('/v1/admin/phone-flags?blocked=true').expect(200);
    expect(listed.body.items.some((f: { phone: string }) => f.phone === e164(CUSTOMER_PHONE))).toBe(true);

    const zones = await admin.get('/v1/admin/delivery-zones').expect(200);
    const inside = zones.body.find((z: { code: string }) => z.code === 'inside_dhaka');
    await admin.patch('/v1/admin/delivery-zones/inside_dhaka').send({ etaText: 'Same day' }).expect(200);
    await admin.patch('/v1/admin/delivery-zones/inside_dhaka').send({ etaText: inside.etaText }).expect(200);
    const audit = await admin.get('/v1/admin/audit-log?entityType=delivery_zone').expect(200);
    expect(audit.body.items[0].after.etaText).toBe(inside.etaText);
  });
});
