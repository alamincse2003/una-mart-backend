import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';
import type { SessionScope, UserRole } from '../generated/prisma/client.js';

export const SESSION_COOKIE = 'una_session';
export const SESSION_TTL_MS: Record<SessionScope, number> = {
  customer: 30 * 24 * 60 * 60_000,
  admin: 12 * 60 * 60_000,
};

/** Who is calling, resolved from the session cookie by SessionGuard. */
export interface AuthUser {
  id: string;
  sessionId: string;
  scope: SessionScope;
  role: UserRole;
  phone: string;
  name: string | null;
  email: string | null;
  phoneVerified: boolean;
}

export type AuthRequest = Request & { auth?: AuthUser };

export function newSessionToken() {
  return randomBytes(32).toString('base64url');
}

/** Only this hash is stored; the raw token lives in the cookie. */
export function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

// Same rules as the cart cookie (decision D4): httpOnly, Lax, Secure in prod.
function cookieOptions(maxAge?: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    ...(maxAge ? { maxAge } : {}),
  };
}

export function readSessionToken(req: Request): string | undefined {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[SESSION_COOKIE];
  return typeof value === 'string' && value.length >= 20 && value.length <= 100 ? value : undefined;
}

export function writeSessionCookie(res: Response, token: string, scope: SessionScope) {
  res.cookie(SESSION_COOKIE, token, cookieOptions(SESSION_TTL_MS[scope]));
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}
