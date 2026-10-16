import type { FastifyBaseLogger } from 'fastify';

/** Structured (pino-compatible) logger surface used outside request handlers. */
export type Logger = Pick<FastifyBaseLogger, 'debug' | 'info' | 'warn' | 'error'>;

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
