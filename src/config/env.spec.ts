import { validateEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  WEB_ORIGIN: 'https://www.unamartbd.com',
  OTP_SECRET: 'x'.repeat(32),
  SMS_PROVIDER: 'console',
};

describe('validateEnv — SMS safety switch', () => {
  it('allows console SMS in development', () => {
    expect(validateEnv({ ...base, NODE_ENV: 'development' }).SMS_PROVIDER).toBe('console');
  });

  it('refuses console SMS on the public production site', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(/not allowed on the public production site/);
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', APP_ENV: 'production' })).toThrow();
  });

  it('allows console SMS on the private staging site', () => {
    const env = validateEnv({ ...base, NODE_ENV: 'production', APP_ENV: 'staging' });
    expect(env.APP_ENV).toBe('staging');
    expect(env.NODE_ENV).toBe('production');
  });

  it('defaults APP_ENV to production and rejects unknown values', () => {
    expect(validateEnv({ ...base, NODE_ENV: 'development' }).APP_ENV).toBe('production');
    expect(() => validateEnv({ ...base, APP_ENV: 'prod' })).toThrow(/APP_ENV must be staging or production/);
  });
});
