import type { Request } from 'express';
import type { AuthRequest } from '../auth/session.js';
import { readCartToken } from './cart-cookie.js';
import type { CartOwner } from './cart.service.js';

/** Logged-in → the user's cart; otherwise the guest cookie's cart (or none). */
export function cartOwner(req: Request): CartOwner | null {
  const auth = (req as AuthRequest).auth;
  if (auth) return { userId: auth.id };
  const guestToken = readCartToken(req);
  return guestToken ? { guestToken } : null;
}
