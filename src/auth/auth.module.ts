import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CartModule } from '../cart/cart.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { OtpService } from './otp.service.js';
import { SessionGuard } from './session.guard.js';
import { SessionService } from './session.service.js';

@Module({
  imports: [CartModule],
  controllers: [AuthController],
  providers: [AuthService, OtpService, SessionService, { provide: APP_GUARD, useClass: SessionGuard }],
  exports: [OtpService, SessionService],
})
export class AuthModule {}
