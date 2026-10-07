import type { CookieOptions, Request, Response } from 'express';

export const CART_COOKIE = 'una_cart';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// httpOnly so page scripts can't read the token; Lax so it travels on
// same-site requests from the storefront; Secure outside development
// (decision D4 — shared parent domain keeps the cookie first-party).
export function cartCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: THIRTY_DAYS_MS,
  };
}

export function readCartToken(req: Request): string | undefined {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[CART_COOKIE];
  return typeof value === 'string' && value.length >= 20 && value.length <= 100 ? value : undefined;
}

export function writeCartToken(res: Response, token: string) {
  res.cookie(CART_COOKIE, token, cartCookieOptions());
}

export function clearCartToken(res: Response) {
  const { maxAge: _maxAge, ...options } = cartCookieOptions();
  res.clearCookie(CART_COOKIE, options);
}
