import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { SessionScope } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  type AuthUser,
  SESSION_TTL_MS,
  clearSessionCookie,
  hashSessionToken,
  newSessionToken,
  readSessionToken,
  writeSessionCookie,
} from './session.js';

const TOUCH_EVERY_MS = 5 * 60_000;

// Server-side sessions in Postgres (decision D4): instantly revocable by
// deleting the row.
@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  async start(userId: string, scope: SessionScope, req: Request, res: Response) {
    // Replace any session this browser already had (no fixation, no pile-up).
    await this.end(req, res);
    const token = newSessionToken();
    await this.prisma.session.create({
      data: {
        userId,
        scope,
        tokenHash: hashSessionToken(token),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS[scope]),
        ip: req.ip ?? null,
        userAgent: req.get('user-agent')?.slice(0, 300) ?? null,
      },
    });
    writeSessionCookie(res, token, scope);
  }

  async resolve(req: Request): Promise<AuthUser | null> {
    const token = readSessionToken(req);
    if (!token) return null;
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt <= new Date()) return null;

    if (Date.now() - session.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    }
    const { user } = session;
    return {
      id: user.id,
      sessionId: session.id,
      scope: session.scope,
      role: user.role,
      phone: user.phone,
      name: user.name,
      email: user.email,
      phoneVerified: user.phoneVerifiedAt !== null,
    };
  }

  async end(req: Request, res: Response) {
    const token = readSessionToken(req);
    if (token) await this.prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
    clearSessionCookie(res);
  }
}
