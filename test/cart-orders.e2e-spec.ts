import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

// Runs against the dev database (`npm run db:up && npm run db:seed`). Uses
// its own throwaway products and removes everything it creates.
describe('Cart + orders (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let productIds: string[] = [];
  let variantId = ''; // ৳500, stock 3, no free delivery
  const orderNumbers: string[] = [];

  const phone = '01712345678';
  const checkoutBody = (overrides: Record<string, unknown> = {}) => ({
    customerName: 'E2E Buyer',
    phone,
    address: { line1: 'House 1, Road 2', area: 'Banani', city: 'Dhaka' },
    deliveryZone: 'outside_dhaka',
    paymentMethod: 'cod',
    ...overrides,
  });
  const stock = async () =>
    (await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stockQty;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'gadgets' } });
    const product = await prisma.product.create({
      data: {
        name: 'E2E Test Item',
        slug: 'e2e-test-item',
        description: 'cart/order e2e',
        categoryId: category.id,
        status: 'active',
        variants: { create: { sku: 'UM-E2E-TEST-ITEM', price: 50000, stockQty: 3 } },
      },
      include: { variants: true },
    });
    productIds = [product.id];
    variantId = product.variants[0].id;

    // A past OTP-verified order makes this a known phone, so the COD risk
    // rules don't ask for an OTP here (that's covered in checkout-risk).
    const zone = await prisma.deliveryZone.findUniqueOrThrow({ where: { code: 'inside_dhaka' } });
    await prisma.order.create({
      data: {
        orderNumber: 'UM-E2E-TRUST',
        customerName: 'E2E Buyer',
        phone: '+8801712345678',
        phoneVerified: true,
        shippingAddress: { line1: 'House 1', city: 'Dhaka' },
        deliveryZoneId: zone.id,
        status: 'cancelled',
        paymentMethod: 'cod',
        subtotal: 0,
        deliveryFee: 0,
        total: 0,
      },
    });
    orderNumbers.push('UM-E2E-TRUST');
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { orderNumber: { in: orderNumbers } } });
    await prisma.stockMovement.deleteMany({ where: { variantId } });
    await prisma.cartItem.deleteMany({ where: { variantId } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await app.close();
  });

  it('GET /v1/delivery-zones lists zones with fees in poisha', async () => {
    const res = await request(app.getHttpServer()).get('/v1/delivery-zones').expect(200);
    expect(res.body.map((z: { code: string; fee: number }) => [z.code, z.fee])).toEqual([
      ['inside_dhaka', 0],
      ['outside_dhaka', 12000],
    ]);
  });

  it('cart: empty without cookie, then add, cap at stock, update, remove', async () => {
    await request(app.getHttpServer()).get('/v1/cart').expect(200, { items: [], itemCount: 0, subtotal: 0 });

    const agent = request.agent(app.getHttpServer());
    const added = await agent.post('/v1/cart/items').send({ variantId, quantity: 2 }).expect(201);
    expect(added.headers['set-cookie']?.[0]).toMatch(/una_cart=.*HttpOnly/i);
    expect(added.body).toMatchObject({ itemCount: 2, subtotal: 100000 });

    const capped = await agent.post('/v1/cart/items').send({ variantId, quantity: 5 }).expect(201);
    expect(capped.body.items[0].quantity).toBe(3); // only 3 in stock

    const itemId = capped.body.items[0].id;
    const updated = await agent.patch(`/v1/cart/items/${itemId}`).send({ quantity: 1 }).expect(200);
    expect(updated.body.subtotal).toBe(50000);

    const removed = await agent.delete(`/v1/cart/items/${itemId}`).expect(200);
    expect(removed.body.items).toEqual([]);
  });

  it('checkout validation and unavailable options', async () => {
    const server = app.getHttpServer();
    const empty = await request(server).post('/v1/orders').send(checkoutBody()).expect(409);
    expect(empty.body).toEqual({ statusCode: 409, code: 'CART_EMPTY', message: 'Your cart is empty.' });

    const agent = request.agent(server);
    await agent.post('/v1/cart/items').send({ variantId, quantity: 1 }).expect(201);
    const bkash = await agent.post('/v1/orders').send(checkoutBody({ paymentMethod: 'bkash' })).expect(422);
    expect(bkash.body.code).toBe('PAYMENT_METHOD_UNAVAILABLE');

    const badPhone = await agent.post('/v1/orders').send(checkoutBody({ phone: '12345' })).expect(422);
    expect(badPhone.body.code).toBe('INVALID_PHONE');

    const invalid = await agent.post('/v1/orders').send(checkoutBody({ address: undefined })).expect(400);
    expect(invalid.body.code).toBe('VALIDATION_FAILED');

    expect(await stock()).toBe(3); // nothing was taken
  });

  it('COD checkout: order created, stock taken, cart emptied, lookup by phone', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/v1/cart/items').send({ variantId, quantity: 2 }).expect(201);

    const res = await agent.post('/v1/orders').send(checkoutBody({ note: 'Call first' })).expect(201);
    orderNumbers.push(res.body.orderNumber);
    expect(res.body).toMatchObject({
      status: 'pending_confirmation',
      paymentMethod: 'cod',
      paymentStatus: 'unpaid',
      phone: '+8801712345678',
      subtotal: 100000,
      deliveryFee: 12000,
      total: 112000,
      cancellable: true,
    });
    expect(res.body.orderNumber).toMatch(/^UM-\d{5,}$/);
    expect(res.body.items[0]).toMatchObject({ productName: 'E2E Test Item', quantity: 2, unitPrice: 50000 });
    expect(res.body.timeline.map((t: { status: string }) => t.status)).toEqual(['pending_confirmation']);

    expect(await stock()).toBe(1);
    const movements = await prisma.stockMovement.findMany({ where: { variantId } });
    expect(movements.map((m) => [m.delta, m.reason])).toEqual([[-2, 'order']]);
    const cart = await agent.get('/v1/cart').expect(200);
    expect(cart.body.items).toEqual([]);

    // Lookup: wrong phone and unknown number look identical.
    await request(app.getHttpServer()).get(`/v1/orders/${res.body.orderNumber}?phone=01899999999`).expect(404);
    await request(app.getHttpServer()).get(`/v1/orders/UM-1?phone=${phone}`).expect(404);
    const found = await request(app.getHttpServer())
      .get(`/v1/orders/${res.body.orderNumber.toLowerCase()}?phone=8801712345678`)
      .expect(200);
    expect(found.body.total).toBe(112000);
  });

  it('two shoppers racing for the last unit: exactly one order succeeds', async () => {
    expect(await stock()).toBe(1);
    const a = request.agent(app.getHttpServer());
    const b = request.agent(app.getHttpServer());
    await a.post('/v1/cart/items').send({ variantId, quantity: 1 }).expect(201);
    await b.post('/v1/cart/items').send({ variantId, quantity: 1 }).expect(201);

    const results = await Promise.all([a.post('/v1/orders').send(checkoutBody()), b.post('/v1/orders').send(checkoutBody())]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(loser.body.code).toBe('OUT_OF_STOCK');
    orderNumbers.push(results.find((r) => r.status === 201)!.body.orderNumber);
    expect(await stock()).toBe(0);
  });

  it('customer cancel restocks; a second cancel is rejected', async () => {
    const [, first] = orderNumbers; // [0] is the trust seed
    const res = await request(app.getHttpServer()).post(`/v1/orders/${first}/cancel?phone=${phone}`).expect(200);
    expect(res.body).toMatchObject({ status: 'cancelled', cancellable: false });
    expect(res.body.timeline.map((t: { status: string }) => t.status)).toEqual(['pending_confirmation', 'cancelled']);
    expect(await stock()).toBe(2); // 0 + the 2 units from the cancelled order

    const again = await request(app.getHttpServer()).post(`/v1/orders/${first}/cancel?phone=${phone}`).expect(409);
    expect(again.body.code).toBe('INVALID_TRANSITION');

    const payment = await prisma.payment.findFirstOrThrow({ where: { order: { orderNumber: first } } });
    expect(payment.status).toBe('cancelled');
  });
});
