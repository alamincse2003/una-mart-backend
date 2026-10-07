// Validates process.env once at startup so a missing or mistyped variable
// fails fast with a clear message instead of a confusing runtime error.
export interface Env {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DATABASE_URL: string;
  WEB_ORIGIN: string[];
  /** Max COD order total in poisha; null = no cap. */
  COD_MAX_ORDER_TOTAL: number | null;
  /** COD orders above this total (poisha) need OTP verification. */
  COD_OTP_THRESHOLD: number;
  /** HMAC key for OTP code hashes. */
  OTP_SECRET: string;
  /** Where OTP SMS go. `console` only logs them (never in production). */
  SMS_PROVIDER: 'console';
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const errors: string[] = [];

  const nodeEnv = String(raw.NODE_ENV ?? 'development');
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    errors.push('NODE_ENV must be development, test or production');
  }

  const port = Number(raw.PORT ?? 4000);
  if (!Number.isInteger(port) || port <= 0) errors.push('PORT must be a positive integer');

  const databaseUrl = raw.DATABASE_URL;
  if (typeof databaseUrl !== 'string' || !/^postgres(ql)?:\/\//.test(databaseUrl)) {
    errors.push('DATABASE_URL must be a postgresql:// connection string');
  }

  const webOrigin = String(raw.WEB_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (webOrigin.length === 0) errors.push('WEB_ORIGIN must list at least one origin');

  let codMax: number | null = null;
  if (raw.COD_MAX_ORDER_TOTAL !== undefined && raw.COD_MAX_ORDER_TOTAL !== '') {
    codMax = Number(raw.COD_MAX_ORDER_TOTAL);
    if (!Number.isInteger(codMax) || codMax <= 0) {
      errors.push('COD_MAX_ORDER_TOTAL must be a positive integer (poisha) or empty');
    }
  }

  const codOtpThreshold = Number(raw.COD_OTP_THRESHOLD || 1_000_000); // ৳10,000
  if (!Number.isInteger(codOtpThreshold) || codOtpThreshold <= 0) {
    errors.push('COD_OTP_THRESHOLD must be a positive integer (poisha)');
  }

  const otpSecret = raw.OTP_SECRET;
  if (typeof otpSecret !== 'string' || otpSecret.length < 32) {
    errors.push('OTP_SECRET must be at least 32 characters');
  }

  const smsProvider = String(raw.SMS_PROVIDER ?? 'console');
  if (smsProvider !== 'console') {
    errors.push('SMS_PROVIDER must be console (no SMS gateway is wired in yet)');
  } else if (nodeEnv === 'production') {
    // Codes would only reach the server log — nobody could log in.
    errors.push('SMS_PROVIDER=console is not allowed in production; configure a real SMS gateway');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid environment:\n  - ${errors.join('\n  - ')}`);
  }

  return {
    NODE_ENV: nodeEnv as Env['NODE_ENV'],
    PORT: port,
    DATABASE_URL: databaseUrl as string,
    WEB_ORIGIN: webOrigin,
    COD_MAX_ORDER_TOTAL: codMax,
    COD_OTP_THRESHOLD: codOtpThreshold,
    OTP_SECRET: otpSecret as string,
    SMS_PROVIDER: 'console',
  };
}
