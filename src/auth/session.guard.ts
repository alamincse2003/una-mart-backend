import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { forbidden, unauthorized } from '../common/app-error.js';
import type { Env } from '../config/env.js';
import { ACCESS_KEY, type Access } from './auth.decorators.js';
import type { AuthRequest } from './session.js';
import { SessionService } from './session.service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Global guard: resolves the session for every request (req.auth), enforces
// @Auth / @AdminOnly, and refuses cookie-carrying writes from foreign
// origins (CSRF defence on top of SameSite=Lax). Role checks live here, on
// the server — a hidden frontend route is not a protected route.
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly reflector: Reflector,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthRequest>();

    if (!SAFE_METHODS.has(req.method) && req.headers.cookie) {
      const origin = req.get('origin');
      if (origin && !this.config.get('WEB_ORIGIN', { infer: true }).includes(origin)) {
        throw forbidden('BAD_ORIGIN', 'Request blocked: unknown origin.');
      }
    }

    req.auth = (await this.sessions.resolve(req)) ?? undefined;

    const access = this.reflector.getAllAndOverride<Access | undefined>(ACCESS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!access) return true;
    if (!req.auth) throw unauthorized();
    if (access === 'admin' && (req.auth.role !== 'admin' || req.auth.scope !== 'admin')) {
      throw forbidden();
    }
    return true;
  }
}
