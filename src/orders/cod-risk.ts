// COD risk rules (SYSTEM_DESIGN.md, decided 2026-10-07 with the spec's
// defaults). Pure, so every rule is unit-tested without a database.

export type OtpReason = 'first_time' | 'refused_before' | 'high_value';

export interface CodRiskInput {
  isBlocked: boolean;
  codRefusedCount: number;
  /** Earlier orders from this phone that were OTP-verified or delivered. */
  trustedOrderCount: number;
  total: number;
  otpThreshold: number;
}

export interface CodRisk {
  blocked: boolean;
  /** Empty = no OTP needed. */
  otpReasons: OtpReason[];
}

export const REFUSALS_BEFORE_OTP = 2;

export function codRisk(input: CodRiskInput): CodRisk {
  if (input.isBlocked) return { blocked: true, otpReasons: [] };
  const otpReasons: OtpReason[] = [];
  if (input.trustedOrderCount === 0) otpReasons.push('first_time');
  if (input.codRefusedCount >= REFUSALS_BEFORE_OTP) otpReasons.push('refused_before');
  if (input.total > input.otpThreshold) otpReasons.push('high_value');
  return { blocked: false, otpReasons };
}
