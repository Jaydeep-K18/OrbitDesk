import { z } from 'zod';

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvValidationError';
  }
}

/**
 * Validates environment variables against a Zod schema and fails fast with a
 * readable list of every problem (not just the first one).
 */
export function loadEnv<T extends z.ZodType>(
  schema: T,
  source: Record<string, string | undefined> = process.env,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const key = issue.path.join('.') || '(root)';
      return `${key}: ${issue.message}`;
    });
    throw new EnvValidationError(issues);
  }
  return result.data;
}

/** Parses "true"/"false"/"1"/"0" env strings into booleans. */
export const envBoolean = (defaultValue: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? defaultValue : v === 'true' || v === '1'));

/** Common variables every Node service understands. */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});
