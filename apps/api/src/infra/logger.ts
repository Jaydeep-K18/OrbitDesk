import { pino, type Logger } from 'pino';

/** Paths never written to logs (ROADMAP §20.4). */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  '*.title',
];

export function createLogger(level: string, pretty = false): Logger {
  return pino({
    level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    base: { service: 'api' },
    ...(pretty
      ? { transport: { target: 'pino-pretty', options: { colorize: true, singleLine: true } } }
      : {}),
  });
}
