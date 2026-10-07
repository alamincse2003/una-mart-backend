import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

// OTP rules from SYSTEM_DESIGN.md → Identity.
export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 5 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_MAX_SENDS = 3;
export const OTP_SEND_WINDOW_MS = 15 * 60_000;

export function generateOtp(): string {
  return randomInt(0, 10 ** OTP_LENGTH)
    .toString()
    .padStart(OTP_LENGTH, '0');
}

/**
 * Keyed hash bound to phone and purpose: a stolen otp_code table can't be
 * brute-forced offline (1M codes) without the secret, and a login code can't
 * be replayed as a checkout code.
 */
export function hashOtp(secret: string, phone: string, purpose: string, code: string): string {
  return createHmac('sha256', secret).update(`${phone}|${purpose}|${code}`).digest('hex');
}

export function otpMatches(expectedHash: string, actualHash: string): boolean {
  const a = Buffer.from(expectedHash, 'hex');
  const b = Buffer.from(actualHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
