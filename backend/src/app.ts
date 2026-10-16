import { sql } from 'drizzle-orm';
import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';
import type { Database } from './database/client.js';
import { sendError } from './lib/http.js';
import { registerIngestionRoutes } from './modules/ingestion/ingestion.routes.js';
import { IngestionService } from './modules/ingestion/ingestion.service.js';
import { PostsRepository } from './modules/posts/posts.repository.js';
import { registerPostRoutes } from './modules/posts/posts.routes.js';
import { SessionsRepository } from './modules/sessions/sessions.repository.js';
import { registerSessionRoutes } from './modules/sessions/sessions.routes.js';

export interface AppDependencies {
  db: Database;
  ingestApiKey: string;
  /** Called after new raw posts are stored, to wake the processing worker. */
  onPostsAccepted?: () => void;
  logger?: FastifyServerOptions['logger'];
}

export function buildApp(deps: AppDependencies) {
  const app = Fastify({
    logger: deps.logger ?? false,
    // Behind nginx + Cloudflare Tunnel; trust X-Forwarded-* for request logging.
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  app.get('/health', async (request, reply) => {
    try {
      await deps.db.execute(sql`select 1`);
      return reply.header('cache-control', 'no-store').send({
        status: 'ok',
        database: 'ok',
        time: new Date().toISOString(),
      });
    } catch (error) {
      request.log.error({ err: error }, 'health check database ping failed');
      return reply.status(503).send({ status: 'error', database: 'unreachable' });
    }
  });

  const posts = new PostsRepository(deps.db);
  registerIngestionRoutes(app, {
    service: new IngestionService(posts, deps.onPostsAccepted),
    apiKey: deps.ingestApiKey,
  });
  registerPostRoutes(app, { posts, apiKey: deps.ingestApiKey });
  registerSessionRoutes(app, { sessions: new SessionsRepository(deps.db) });

  app.setNotFoundHandler((_request, reply) => sendError(reply, 404, 'NOT_FOUND', 'Route not found'));

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    if (statusCode === 413) {
      return sendError(reply, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    }
    if (statusCode >= 400 && statusCode < 500) {
      return sendError(reply, statusCode, 'VALIDATION_ERROR', error.message);
    }
    request.log.error({ err: error }, 'unhandled request error');
    return sendError(reply, 500, 'INTERNAL_ERROR', 'Internal server error');
  });

  return app;
}
