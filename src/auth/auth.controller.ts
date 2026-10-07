import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Auth, CurrentUser } from './auth.decorators.js';
import { AdminLoginDto, MeDto, OtpRequestDto, OtpSentDto, OtpVerifyDto, UpdateMeDto } from './auth.dto.js';
import { AuthService } from './auth.service.js';
import { SESSION_COOKIE, type AuthUser } from './session.js';

const MINUTE = 60_000;

@ApiTags('Auth')
@ApiCookieAuth(SESSION_COOKIE)
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Sends a 6-digit code by SMS (max 3 per phone per 15 minutes). */
  @Post('otp/request')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: MINUTE } })
  @ApiOkResponse({ type: OtpSentDto })
  requestOtp(@Body() body: OtpRequestDto): Promise<OtpSentDto> {
    return this.auth.requestOtp(body.phone, body.purpose);
  }

  /** Customer login. Sets the session cookie and merges the guest cart. */
  @Post('otp/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @ApiOkResponse({ type: MeDto })
  verifyOtp(
    @Body() body: OtpVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeDto> {
    return this.auth.verifyLogin(body.phone, body.code, req, res);
  }

  /** Admin step 1: phone + password → an OTP is sent. */
  @Post('admin/login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: MINUTE } })
  @ApiOkResponse({ type: OtpSentDto })
  adminLogin(@Body() body: AdminLoginDto): Promise<OtpSentDto> {
    return this.auth.adminLogin(body.phone, body.password);
  }

  /** Admin step 2: the OTP → 12-hour admin session. */
  @Post('admin/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @ApiOkResponse({ type: MeDto })
  adminVerify(
    @Body() body: OtpVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeDto> {
    return this.auth.adminVerify(body.phone, body.code, req, res);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(req, res);
  }

  @Get('me')
  @Auth()
  @ApiOkResponse({ type: MeDto })
  me(@CurrentUser() user: AuthUser): MeDto {
    return this.auth.me(user);
  }

  @Patch('me')
  @Auth()
  @ApiOkResponse({ type: MeDto })
  updateMe(@CurrentUser() user: AuthUser, @Body() body: UpdateMeDto): Promise<MeDto> {
    return this.auth.updateMe(user, body);
  }
}
