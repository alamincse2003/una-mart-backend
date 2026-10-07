import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OtpPurpose, Prisma } from '../generated/prisma/client.js';
import { tooManyRequests, unprocessable } from '../common/app-error.js';
import type { Env } from '../config/env.js';
import { SmsSender } from '../notifications/sms.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS,
  OTP_SEND_WINDOW_MS,
  OTP_TTL_MS,
  generateOtp,
  hashOtp,
  otpMatches,
} from './otp.js';

export interface OtpSent {
  expiresInSeconds: number;
  /** Only outside production, while SMS go to the console. */
  devCode?: string;
}

const INVALID = () => unprocessable('OTP_INVALID', 'That code is wrong or has expired. Please request a new one.');

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsSender,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Sends a fresh code; older unused codes for the same phone+purpose stop working. */
  async send(phone: string, purpose: OtpPurpose): Promise<OtpSent> {
    const recent = await this.prisma.otpCode.count({
      where: { phone, createdAt: { gt: new Date(Date.now() - OTP_SEND_WINDOW_MS) } },
    });
    if (recent >= OTP_MAX_SENDS) {
      throw tooManyRequests('OTP_RATE_LIMITED', 'Too many codes requested. Please try again in 15 minutes.');
    }

    const code = generateOtp();
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.otpCode.updateMany({
        where: { phone, purpose, consumedAt: null, expiresAt: { gt: now } },
        data: { expiresAt: now },
      }),
      this.prisma.otpCode.create({
        data: {
          phone,
          purpose,
          codeHash: hashOtp(this.secret(), phone, purpose, code),
          expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        },
      }),
    ]);
    await this.sms.send(phone, `Your UNA Mart code is ${code}. It expires in 5 minutes. Never share it.`);

    const isProduction = this.config.get('NODE_ENV', { infer: true }) === 'production';
    return { expiresInSeconds: OTP_TTL_MS / 1000, ...(isProduction ? {} : { devCode: code }) };
  }

  /**
   * Checks a code and counts the attempt (outside any caller transaction, so
   * a wrong guess is counted even if the caller later fails). Returns the
   * code's id for `consume`. After 5 wrong guesses the code is dead.
   */
  async check(phone: string, purpose: OtpPurpose, code: string): Promise<string> {
    const otp = await this.prisma.otpCode.findFirst({
      where: { phone, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw INVALID();

    const { count } = await this.prisma.otpCode.updateMany({
      where: { id: otp.id, attempts: { lt: OTP_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (count === 0) {
      throw unprocessable('OTP_LOCKED', 'Too many wrong tries. Please request a new code.');
    }
    if (!otpMatches(otp.codeHash, hashOtp(this.secret(), phone, purpose, code))) throw INVALID();
    return otp.id;
  }

  /** Marks the code used; a code works exactly once even under concurrency. */
  async consume(tx: Prisma.TransactionClient, otpId: string) {
    const { count } = await tx.otpCode.updateMany({
      where: { id: otpId, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (count === 0) throw INVALID();
  }

  private secret() {
    return this.config.get('OTP_SECRET', { infer: true });
  }
}
