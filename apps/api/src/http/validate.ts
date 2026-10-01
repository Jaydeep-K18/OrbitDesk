import type { z } from 'zod';
import { AppError, zodToFieldErrors } from './errors.js';

/** Parses untrusted input with a Zod schema; failures become 422 problem documents. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) throw AppError.validation(zodToFieldErrors(result.error));
  return result.data;
}

/** Route params must be UUIDs; anything else is simply "not found". */
export function uuidParam(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw AppError.notFound();
  }
  return value.toLowerCase();
}
