import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from './../src/prisma/prisma.service.js';
import { checkoutBody, cleanup, createTestApp, createTestProduct, e164, loginCustomer, requestOtp } from './helpers.js';

const NEW_PHONE = '01300000101'; // first-time guest
const BLOCKED_PHONE = '01300000102';
const MEMBER_PHONE = '01300000103'; // logged in with a verified phone
const PHONES = [NEW_PHONE, BLOCKED_PHONE, MEMBER_PHONE];
const CHEAP = 'e2e-risk-cheap'; // ৳600
const PRICEY = 'e2e-risk-pricey'; // ৳6,000

describe('COD risk rules at checkout (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cheap = '';
  let pricey = '';
  const server = () => app.getHttpServer();
  const stockOf = async (variantId: string) =>
    (await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stockQty;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await cleanup(prisma, { phones: PHONES, productSlugs: [CHEAP, PRICEY] });
    cheap = (await createTestProduct(prisma, CHEAP, { price: 60000, stockQty: 20 })).variantId;
    pricey = (await createTestProduct(prisma, PRICEY, { price: 600000, stockQty: 5 })).variantId;
  });

  afterAll(async () => {
    await cleanup(prisma, { phones: PHONES, productSlugs: [CHEAP, PRICEY] });
    await app.close();
  });

  it('first-time phone: 428 OTP_REQUIRED, wrong code 422, right code → auto-confirmed', async () => {
    const agent = request.agent(server());
    await agent.post('/v1/cart/items').send({ variantId: cheap, quantity: 1 }).expect(201);

    const needOtp = await agent.post('/v1/orders').send(checkoutBody(NEW_PHONE)).expect(428);
    expect(needOtp.body).toMatchObject({ statusCode: 428, code: 'OTP_REQUIRED' });
    expect(await stockOf(cheap)).toBe(20); // nothing taken

    const code = await requestOtp(agent, NEW_PHONE, 'checkout');
    const wrong = await agent
      .post('/v1/orders')
      .send(checkoutBody(NEW_PHONE, { otpCode: code === '000000' ? '111111' : '000000' }))
      .expect(422);
    expect(wrong.body.code).toBe('OTP_INVALID');

    const res = await agent.post('/v1/orders').send(checkoutBody(NEW_PHONE, { otpCode: code })).expect(201);
    expect(res.body.status).toBe('confirmed');
    expect(res.body.timeline.map((t: { status: string }) => t.status)).toEqual(['pending_confirmation', 'confirmed']);
    const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: res.body.orderNumber } });
    expect(order.phoneVerified).toBe(true);
    expect(await stockOf(cheap)).toBe(19);
  });

  it('known phone orders without OTP and waits for a confirmation call', async () => {
    const agent = request.agent(server());
    await agent.post('/v1/cart/items').send({ variantId: cheap, quantity: 1 }).expect(201);
    const res = await agent.post('/v1/orders').send(checkoutBody(NEW_PHONE)).expect(201);
    expect(res.body.status).toBe('pending_confirmation');
  });

  it('above ৳10,000 needs an OTP even for a known phone', async () => {
    const agent = request.agent(server());
    await agent.post('/v1/cart/items').send({ variantId: pricey, quantity: 2 }).expect(201); // ৳12,000 + delivery
    const res = await agent.post('/v1/orders').send(checkoutBody(NEW_PHONE)).expect(428);
    expect(res.body.code).toBe('OTP_REQUIRED');
  });

  it('2 refused COD deliveries → OTP again', async () => {
    await prisma.phoneFlag.create({ data: { phone: e164(NEW_PHONE), codRefusedCount: 2 } });
    const agent = request.agent(server());
    await agent.post('/v1/cart/items').send({ variantId: cheap, quantity: 1 }).expect(201);
    await agent.post('/v1/orders').send(checkoutBody(NEW_PHONE)).expect(428);
  });

  it('blocked phone cannot use COD', async () => {
    await prisma.phoneFlag.create({ data: { phone: e164(BLOCKED_PHONE), isBlocked: true } });
    const agent = request.agent(server());
    await agent.post('/v1/cart/items').send({ variantId: cheap, quantity: 1 }).expect(201);
    const res = await agent.post('/v1/orders').send(checkoutBody(BLOCKED_PHONE)).expect(422);
    expect(res.body.code).toBe('COD_BLOCKED');
  });

  it('logged-in member: no OTP for own phone, my orders, lookup without phone', async () => {
    const member = request.agent(server());
    await loginCustomer(member, MEMBER_PHONE);
    await member.post('/v1/cart/items').send({ variantId: cheap, quantity: 1 }).expect(201);

    // A different phone on the order is not covered by the login.
    await member.post('/v1/orders').send(checkoutBody('01300000199')).expect(428);

    const res = await member.post('/v1/orders').send(checkoutBody(MEMBER_PHONE)).expect(201);
    expect(res.body.status).toBe('confirmed');
    const { orderNumber } = res.body;

    const mine = await member.get('/v1/orders').expect(200);
    expect(mine.body.items.map((o: { orderNumber: string }) => o.orderNumber)).toEqual([orderNumber]);
    await member.get(`/v1/orders/${orderNumber}`).expect(200);

    // Strangers still need the phone, and get the same 404 without it.
    await request(server()).get(`/v1/orders/${orderNumber}`).expect(404);
    await request(server()).get(`/v1/orders/${orderNumber}?phone=${MEMBER_PHONE}`).expect(200);

    const cancelled = await member.post(`/v1/orders/${orderNumber}/cancel`).expect(200);
    expect(cancelled.body.status).toBe('cancelled');
  });
});
