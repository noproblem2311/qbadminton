import type { FastifyInstance } from 'fastify';
import { formatZodIssues, sendError } from '../../lib/http.js';
import type { SessionsRepository } from './sessions.repository.js';
import { toSessionDto } from './sessions.mapper.js';
import { listSessionsQuerySchema, sessionIdParamsSchema } from './sessions.schema.js';

export function registerSessionRoutes(
  app: FastifyInstance,
  deps: { sessions: SessionsRepository },
) {
  app.get('/api/v1/sessions', async (request, reply) => {
    const parsed = listSessionsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(
        reply,
        400,
        'VALIDATION_ERROR',
        'Invalid query parameters',
        formatZodIssues(parsed.error),
      );
    }

    const { level, ...filters } = parsed.data;
    const rows = await deps.sessions.listUpcoming({ ...filters, levels: level });
    return reply.header('cache-control', 'no-store').send({
      success: true,
      data: rows.map(toSessionDto),
      meta: {
        count: rows.length,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
        serverTime: new Date().toISOString(),
      },
    });
  });

  app.get('/api/v1/sessions/:id', async (request, reply) => {
    const parsed = sessionIdParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return sendError(reply, 404, 'NOT_FOUND', 'Session not found');
    }
    const row = await deps.sessions.findById(parsed.data.id);
    if (!row) return sendError(reply, 404, 'NOT_FOUND', 'Session not found');
    return reply.send({ success: true, data: toSessionDto(row) });
  });
}
