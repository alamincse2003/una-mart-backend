import { generateOtp, hashOtp, otpMatches } from './otp.js';
import { hashSessionToken, newSessionToken } from './session.js';

const SECRET = 'x'.repeat(32);

describe('OTP helpers', () => {
  it('generates 6-digit codes, zero-padded', () => {
    for (let i = 0; i < 200; i++) expect(generateOtp()).toMatch(/^\d{6}$/);
  });

  it('binds the hash to phone, purpose and secret', () => {
    const h = hashOtp(SECRET, '+8801712345678', 'login', '123456');
    expect(otpMatches(h, hashOtp(SECRET, '+8801712345678', 'login', '123456'))).toBe(true);
    expect(otpMatches(h, hashOtp(SECRET, '+8801712345678', 'login', '123457'))).toBe(false);
    expect(otpMatches(h, hashOtp(SECRET, '+8801812345678', 'login', '123456'))).toBe(false);
    expect(otpMatches(h, hashOtp(SECRET, '+8801712345678', 'checkout', '123456'))).toBe(false);
    expect(otpMatches(h, hashOtp('y'.repeat(32), '+8801712345678', 'login', '123456'))).toBe(false);
  });

  it('never stores the code itself', () => {
    expect(hashOtp(SECRET, '+8801712345678', 'login', '123456')).not.toContain('123456');
  });
});

describe('session tokens', () => {
  it('are random and stored only as a hash', () => {
    const a = newSessionToken();
    expect(a).not.toBe(newSessionToken());
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(hashSessionToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(a)).toBe(hashSessionToken(a));
  });
});
