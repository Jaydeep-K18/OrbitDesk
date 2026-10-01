import { baseEnvSchema, envBoolean, loadEnv } from '@focusguard/config';
import { z } from 'zod';

export const apiEnvSchema = baseEnvSchema
  .extend({
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    APP_ORIGIN: z.string().url().default('http://localhost:5173'),
    APP_VERSION: z.string().default('0.1.0'),
    /** Ed25519 private key as a JWK JSON string. Generated ephemerally in development/test. */
    JWT_PRIVATE_JWK: z.string().optional(),
    JWT_KID: z.string().default('dev-1'),
    ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    DEVICE_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(90),
    COOKIE_SECURE: envBoolean(true),
    SMTP_URL: z.string().optional(),
    MAIL_FROM: z.string().default('FocusGuard <no-reply@focusguard.local>'),
    LIFECYCLE_INTERVAL_MS: z.coerce.number().int().min(1000).default(15_000),
    FINALIZE_GRACE_SEC: z.coerce.number().int().min(0).default(120),
    MIN_EXTENSION_VERSION: z.string().default('0.1.0'),
    /** Comma-separated extra origins allowed to call the API with bearer tokens (extension). */
    EXTENSION_ORIGINS: z.string().default('chrome-extension://dmfegmfpjfegcdhojmpbbghakajhgpec'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.JWT_PRIVATE_JWK) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_PRIVATE_JWK'],
        message: 'required in production',
      });
    }
  });

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function loadApiEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  return loadEnv(apiEnvSchema, source);
}
