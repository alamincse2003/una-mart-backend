import { codRisk } from './cod-risk.js';

const base = { isBlocked: false, codRefusedCount: 0, trustedOrderCount: 1, total: 50_000, otpThreshold: 1_000_000 };

describe('codRisk (SYSTEM_DESIGN.md COD risk rules)', () => {
  it('lets a known, clean phone order without OTP', () => {
    expect(codRisk(base)).toEqual({ blocked: false, otpReasons: [] });
  });

  it('blocks COD for a blocked phone', () => {
    expect(codRisk({ ...base, isBlocked: true }).blocked).toBe(true);
  });

  it('asks first-time phones for an OTP', () => {
    expect(codRisk({ ...base, trustedOrderCount: 0 }).otpReasons).toEqual(['first_time']);
  });

  it('asks for an OTP after 2 refused COD deliveries, not after 1', () => {
    expect(codRisk({ ...base, codRefusedCount: 1 }).otpReasons).toEqual([]);
    expect(codRisk({ ...base, codRefusedCount: 2 }).otpReasons).toEqual(['refused_before']);
  });

  it('asks for an OTP above the threshold (৳10,000), not at it', () => {
    expect(codRisk({ ...base, total: 1_000_000 }).otpReasons).toEqual([]);
    expect(codRisk({ ...base, total: 1_000_001 }).otpReasons).toEqual(['high_value']);
  });

  it('lists every reason that applies', () => {
    expect(codRisk({ ...base, trustedOrderCount: 0, codRefusedCount: 3, total: 2_000_000 }).otpReasons).toEqual([
      'first_time',
      'refused_before',
      'high_value',
    ]);
  });
});
