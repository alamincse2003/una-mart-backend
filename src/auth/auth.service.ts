import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import type { Request, Response } from 'express';
import { conflict, unauthorized, unprocessable } from '../common/app-error.js';
import { normalizeBdPhone } from '../common/phone.js';
import { clearCartToken, readCartToken } from '../cart/cart-cookie.js';
import { CartService } from '../cart/cart.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { MeDto, UpdateMeDto } from './auth.dto.js';
import { type OtpSent, OtpService } from './otp.service.js';
import type { AuthUser } from './session.js';
import { SessionService } from './session.service.js';

const BAD_CREDENTIALS = () => unauthorized('INVALID_CREDENTIALS', 'Wrong phone number or password.');

// Compared against when the phone has no admin account, so a wrong phone
// takes as long as a wrong password (no account probing by timing).
let dummyHash: Promise<string> | undefined;

export function requirePhone(raw: string): string {
  const phone = normalizeBdPhone(raw);
  if (!phone) throw unprocessable('INVALID_PHONE', 'Enter an 11-digit mobile number, e.g. 01712345678.');
  return phone;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly sessions: SessionService,
    private readonly cart: CartService,
  ) {}

  requestOtp(rawPhone: string, purpose: 'login' | 'checkout'): Promise<OtpSent> {
    return this.otp.send(requirePhone(rawPhone), purpose);
  }

  /** Customer login: a verified code creates the account on first use. */
  async verifyLogin(rawPhone: string, code: string, req: Request, res: Response): Promise<MeDto> {
    const phone = requirePhone(rawPhone);
    const otpId = await this.otp.check(phone, 'login', code);
    const user = await this.prisma.$transaction(async (tx) => {
      await this.otp.consume(tx, otpId);
      return tx.user.upsert({
        where: { phone },
        create: { phone, phoneVerifiedAt: new Date() },
        update: { phoneVerifiedAt: new Date() },
      });
    });
    await this.sessions.start(user.id, 'customer', req, res);

    const guestToken = readCartToken(req);
    if (guestToken) {
      await this.cart.mergeGuestCart(guestToken, user.id);
      clearCartToken(res);
    }
    return { id: user.id, phone, name: user.name, email: user.email, role: user.role, scope: 'customer' };
  }

  /** Admin step 1: password. Only then is an OTP sent to the admin's phone. */
  async adminLogin(rawPhone: string, password: string): Promise<OtpSent> {
    const phone = normalizeBdPhone(rawPhone);
    const user = phone ? await this.prisma.user.findUnique({ where: { phone } }) : null;
    const admin = user?.role === 'admin' && user.passwordHash ? user : null;
    if (!admin) {
      dummyHash ??= hash('not-a-real-password-just-for-timing');
      await verify(await dummyHash, password);
      throw BAD_CREDENTIALS();
    }
    if (!(await verify(admin.passwordHash!, password))) throw BAD_CREDENTIALS();
    return this.otp.send(admin.phone, 'admin_login');
  }

  /** Admin step 2: the OTP. Starts a 12-hour admin session. */
  async adminVerify(rawPhone: string, code: string, req: Request, res: Response): Promise<MeDto> {
    const phone = requirePhone(rawPhone);
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user || user.role !== 'admin') throw BAD_CREDENTIALS();
    const otpId = await this.otp.check(phone, 'admin_login', code);
    await this.prisma.$transaction(async (tx) => {
      await this.otp.consume(tx, otpId);
      await tx.user.update({ where: { id: user.id }, data: { phoneVerifiedAt: user.phoneVerifiedAt ?? new Date() } });
    });
    await this.sessions.start(user.id, 'admin', req, res);
    return { id: user.id, phone, name: user.name, email: user.email, role: user.role, scope: 'admin' };
  }

  logout(req: Request, res: Response) {
    return this.sessions.end(req, res);
  }

  me(user: AuthUser): MeDto {
    return { id: user.id, phone: user.phone, name: user.name, email: user.email, role: user.role, scope: user.scope };
  }

  async updateMe(user: AuthUser, input: UpdateMeDto): Promise<MeDto> {
    const email = input.email?.trim().toLowerCase();
    if (email) {
      const taken = await this.prisma.user.findFirst({ where: { email, id: { not: user.id } }, select: { id: true } });
      if (taken) throw conflict('EMAIL_TAKEN', 'That email is already used by another account.');
    }
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { ...(input.name ? { name: input.name.trim() } : {}), ...(email ? { email } : {}) },
    });
    return this.me({ ...user, name: updated.name, email: updated.email });
  }
}
