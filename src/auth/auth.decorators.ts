import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { AuthRequest, AuthUser } from './session.js';

export const ACCESS_KEY = 'una:access';
export type Access = 'user' | 'admin';

/** Any logged-in user. */
export const Auth = () => SetMetadata(ACCESS_KEY, 'user' satisfies Access);

/** Admin role AND an admin session (password + OTP login). */
export const AdminOnly = () => SetMetadata(ACCESS_KEY, 'admin' satisfies Access);

/** The caller, or null for guests. Use on routes without @Auth/@AdminOnly too. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | null =>
    ctx.switchToHttp().getRequest<AuthRequest>().auth ?? null,
);
