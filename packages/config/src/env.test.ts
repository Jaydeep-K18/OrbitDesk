import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EnvValidationError, envBoolean, loadEnv } from './env.js';

describe('loadEnv', () => {
  const schema = z.object({
    PORT: z.coerce.number().int().positive(),
    DATABASE_URL: z.string().url(),
    FEATURE: envBoolean(false),
  });

  it('parses and coerces valid values', () => {
    const env = loadEnv(schema, {
      PORT: '4000',
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      FEATURE: 'true',
    });
    expect(env).toEqual({
      PORT: 4000,
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      FEATURE: true,
    });
  });

  it('applies boolean defaults', () => {
    const env = loadEnv(schema, { PORT: '1', DATABASE_URL: 'postgres://localhost/db' });
    expect(env.FEATURE).toBe(false);
  });

  it('reports every invalid variable at once', () => {
    try {
      loadEnv(schema, { PORT: 'abc' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const issues = (err as EnvValidationError).issues;
      expect(issues.some((i) => i.startsWith('PORT'))).toBe(true);
      expect(issues.some((i) => i.startsWith('DATABASE_URL'))).toBe(true);
    }
  });
});
