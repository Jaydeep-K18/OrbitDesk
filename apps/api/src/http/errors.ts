import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Problem, ProblemCode } from '@focusguard/contracts';
import { ZodError } from 'zod';

const PROBLEM_BASE = 'https://focusguard.app/problems/';

const DEFAULT_TITLES: Partial<Record<ProblemCode, string>> = {
  VALIDATION_FAILED: 'Request validation failed',
  UNAUTHENTICATED: 'Authentication required',
  FORBIDDEN: 'Forbidden',
  NOT_FOUND: 'Resource not found',
  CONFLICT: 'Conflict',
  RATE_LIMITED: 'Too many requests',
  PAYLOAD_TOO_LARGE: 'Payload too large',
  SERVICE_UNAVAILABLE: 'Service unavailable',
  INTERNAL: 'Internal server error',
};

/** Typed application error that maps 1:1 to an RFC 9457 problem document. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ProblemCode,
    public readonly title: string = DEFAULT_TITLES[code] ?? code,
    public readonly detail?: string,
    public readonly fieldErrors?: { path: string; message: string }[],
  ) {
    super(detail ?? title);
    this.name = 'AppError';
  }

  static notFound(detail?: string) {
    return new AppError(404, 'NOT_FOUND', undefined, detail);
  }
  static unauthenticated(detail?: string) {
    return new AppError(401, 'UNAUTHENTICATED', undefined, detail);
  }
  static conflict(code: ProblemCode, title: string, detail?: string) {
    return new AppError(409, code, title, detail);
  }
  static validation(fieldErrors: { path: string; message: string }[]) {
    return new AppError(422, 'VALIDATION_FAILED', undefined, undefined, fieldErrors);
  }
}

function toSlug(code: ProblemCode): string {
  return code.toLowerCase().replace(/_/g, '-');
}

export function zodToFieldErrors(err: ZodError): { path: string; message: string }[] {
  return err.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message }));
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(AppError.notFound(`No route for ${req.method} ${req.path}`));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let appError: AppError;
  if (err instanceof AppError) {
    appError = err;
  } else if (err instanceof ZodError) {
    appError = AppError.validation(zodToFieldErrors(err));
  } else if (err?.type === 'entity.too.large') {
    appError = new AppError(413, 'PAYLOAD_TOO_LARGE');
  } else if (err?.type === 'entity.parse.failed') {
    appError = new AppError(400, 'VALIDATION_FAILED', 'Malformed JSON body');
  } else {
    req.log?.error({ err }, 'unhandled error');
    appError = new AppError(500, 'INTERNAL');
  }

  const body: Problem = {
    type: PROBLEM_BASE + toSlug(appError.code),
    title: appError.title,
    status: appError.status,
    code: appError.code,
    ...(appError.detail ? { detail: appError.detail } : {}),
    ...(appError.fieldErrors ? { errors: appError.fieldErrors } : {}),
    requestId: String(req.id ?? ''),
  };
  res.status(appError.status).type('application/problem+json').json(body);
};
