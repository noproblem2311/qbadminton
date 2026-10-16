import type { FastifyInstance } from 'fastify';
import { formatZodIssues, sendError } from '../../lib/http.js';
import { createApiKeyGuard } from './api-key.guard.js';
import { ingestRequestSchema } from './ingestion.schema.js';
import type { IngestionService } from './ingestion.service.js';

export function registerIngestionRoutes(
  app: FastifyInstance,
  deps: { service: IngestionService; apiKey: string },
) {
  app.post(
    '/api/v1/posts/ingest',
    { preHandler: createApiKeyGuard(deps.apiKey), bodyLimit: 1024 * 1024 },
    async (request, reply) => {
      const parsed = ingestRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(
          reply,
          400,
          'VALIDATION_ERROR',
          'Invalid ingest payload',
          formatZodIssues(parsed.error),
        );
      }

      const summary = await deps.service.ingest(parsed.data);
      request.log.info(
        { received: summary.received, accepted: summary.accepted, duplicates: summary.duplicates },
        'posts ingested',
      );
      return reply.send({ success: true, data: summary });
    },
  );
}
