import type { FastifyReply } from 'fastify';
import type { z } from 'zod';

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'PAYLOAD_TOO_LARGE'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: ErrorCode,
  message: string,
  details?: unknown,
) {
  return reply.status(statusCode).send({
    success: false,
    error: details === undefined ? { code, message } : { code, message, details },
  });
}

export function formatZodIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}
