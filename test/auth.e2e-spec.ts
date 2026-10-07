import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { OTP_MAX_SENDS } from './../src/auth/otp.js';
import type { PrismaService } from './../src/prisma/prisma.service.js';
import { cleanup, createTestApp, createTestProduct, e164, requestOtp } from './helpers.js';

const PHONE = '01300000001'; // login + cart merge
const LOCK_PHONE = '01300000002'; // wrong-code lockout
const LIMIT_PHONE = '01300000003'; // send limit
const SLUG = 'e2e-auth-item';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let variantId = '';

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await cleanup(prisma, { phones: [PHONE, LOCK_PHONE, LIMIT_PHONE], productSlugs: [SLUG] });
    ({ variantId } = await createTestProduct(prisma, SLUG, { price: 30000, stockQty: 10 }));
  });

  afterAll(async () => {
    await cleanup(prisma, { phones: [PHONE, LOCK_PHONE, LIMIT_PHONE], productSlugs: [SLUG] });
    await app.close();
  });

  it('rejects a non-Bangladeshi phone', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/otp/request')
      .send({ phone: '12345', purpose: 'login' })
      .expect(422);
    expect(res.body.code).toBe('INVALID_PHONE');
  });

  it('OTP login: wrong code, right code, session cookie, guest cart merged, me, logout', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/v1/cart/items').send({ variantId, quantity: 2 }).expect(201);

    const code = await requestOtp(agent, PHONE, 'login');
    expect(code).toMatch(/^\d{6}$/);
    const stored = await prisma.otpCode.findFirstOrThrow({ where: { phone: e164(PHONE) } });
    expect(stored.codeHash).not.toContain(code); // only a keyed hash is stored

    const wrong = await agent
      .post('/v1/auth/otp/verify')
      .send({ phone: PHONE, code: code === '000000' ? '111111' : '000000' })
      .expect(422);
    expect(wrong.body.code).toBe('OTP_INVALID');

    const ok = await agent.post('/v1/auth/otp/verify').send({ phone: PHONE, code }).expect(200);
    expect(ok.body).toMatchObject({ phone: e164(PHONE), role: 'customer', scope: 'customer' });
    const cookies = ok.headers['set-cookie'] as unknown as string[];
    const session = cookies.find((c) => c.startsWith('una_session='))!;
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
    expect(cookies.some((c) => c.startsWith('una_cart=;'))).toBe(true); // guest cookie cleared

    const token = decodeURIComponent(session.split(';')[0].split('=')[1]);
    expect(await prisma.session.count({ where: { tokenHash: token } })).toBe(0); // stored hashed

    const cart = await agent.get('/v1/cart').expect(200);
    expect(cart.body.items.map((i: { variantId: string; quantity: number }) => [i.variantId, i.quantity])).toEqual([
      [variantId, 2],
    ]);

    // A code works once.
    const reuse = await agent.post('/v1/auth/otp/verify').send({ phone: PHONE, code }).expect(422);
    expect(reuse.body.code).toBe('OTP_INVALID');

    await agent.get('/v1/auth/me').expect(200);
    const named = await agent.patch('/v1/auth/me').send({ name: 'E2E Shopper' }).expect(200);
    expect(named.body.name).toBe('E2E Shopper');

    await agent.post('/v1/auth/logout').expect(204);
    const after = await agent.get('/v1/auth/me').expect(401);
    expect(after.body).toEqual({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Please log in.' });
    expect(await prisma.session.count({ where: { user: { phone: e164(PHONE) } } })).toBe(0);
  });

  it('a code dies after 5 wrong tries, even for the right code', async () => {
    const agent = request.agent(app.getHttpServer());
    const code = await requestOtp(agent, LOCK_PHONE, 'login');
    const wrongCode = code === '999999' ? '888888' : '999999';
    for (let i = 0; i < 5; i++) {
      const res = await agent.post('/v1/auth/otp/verify').send({ phone: LOCK_PHONE, code: wrongCode }).expect(422);
      expect(res.body.code).toBe('OTP_INVALID');
    }
    const locked = await agent.post('/v1/auth/otp/verify').send({ phone: LOCK_PHONE, code }).expect(422);
    expect(locked.body.code).toBe('OTP_LOCKED');
  });

  it(`at most ${OTP_MAX_SENDS} codes per phone per 15 minutes`, async () => {
    // Pretend the limit was already used (the per-IP limiter would trip first otherwise).
    await prisma.otpCode.createMany({
      data: Array.from({ length: OTP_MAX_SENDS }, () => ({
        phone: e164(LIMIT_PHONE),
        purpose: 'login' as const,
        codeHash: 'x',
        expiresAt: new Date(Date.now() + 60_000),
      })),
    });
    const res = await request(app.getHttpServer())
      .post('/v1/auth/otp/request')
      .send({ phone: LIMIT_PHONE, purpose: 'login' })
      .expect(429);
    expect(res.body.code).toBe('OTP_RATE_LIMITED');
  });

  it('protected routes need a session', async () => {
    await request(app.getHttpServer()).get('/v1/orders').expect(401);
    await request(app.getHttpServer()).get('/v1/auth/me').expect(401);
  });
});
