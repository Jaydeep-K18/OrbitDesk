import { baseEnvSchema, loadEnv } from '@focusguard/config';
import { z } from 'zod';

export const apiEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  APP_VERSION: z.string().default('0.1.0'),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function loadApiEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  return loadEnv(apiEnvSchema, source);
}
