import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendError } from '../../lib/http.js';

const digest = (value: string) => createHash('sha256').update(value).digest();

function extractKey(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) return authorization.slice('Bearer '.length).trim();
  const headerKey = request.headers['x-api-key'];
  return typeof headerKey === 'string' ? headerKey.trim() : null;
}

/** Fastify preHandler that requires the extension's shared API key. */
export function createApiKeyGuard(expectedKey: string) {
  const expected = digest(expectedKey);
  return async function apiKeyGuard(request: FastifyRequest, reply: FastifyReply) {
    const provided = extractKey(request);
    // Compare fixed-length digests so the check is constant-time.
    if (!provided || !timingSafeEqual(digest(provided), expected)) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Missing or invalid API key');
    }
  };
}
