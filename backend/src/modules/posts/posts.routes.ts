import type { FastifyInstance } from 'fastify';
import type { RawPost } from '../../database/schema.js';
import { formatZodIssues, sendError } from '../../lib/http.js';
import { createApiKeyGuard } from '../ingestion/api-key.guard.js';
import { buildPostUrl } from '../sessions/sessions.mapper.js';
import type { PostsRepository } from './posts.repository.js';
import { listPostsQuerySchema } from './posts.schema.js';

function toRawPostDto(post: RawPost, sessionCount: number) {
  return {
    id: post.id,
    facebookPostId: post.facebookPostId,
    groupId: post.groupId,
    postUrl: buildPostUrl(post),
    author: post.author,
    content: post.content,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    capturedAt: post.capturedAt.toISOString(),
    processingStatus: post.processingStatus,
    processingAttempts: post.processingAttempts,
    lastError: post.lastError,
    duplicateOfPostId: post.duplicateOfPostId,
    skipReason: post.skipReason,
    sessionCount,
    createdAt: post.createdAt.toISOString(),
  };
}

/**
 * Raw captured posts for the owner's debug view. Protected by the same key as
 * ingestion: it includes non-recruitment posts and processing errors.
 */
export function registerPostRoutes(app: FastifyInstance, deps: { posts: PostsRepository; apiKey: string }) {
  app.get('/api/v1/posts', { preHandler: createApiKeyGuard(deps.apiKey) }, async (request, reply) => {
    const parsed = listPostsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Invalid query parameters', formatZodIssues(parsed.error));
    }

    const [{ rows, total }, counts] = await Promise.all([
      deps.posts.list(parsed.data),
      deps.posts.countByStatus(),
    ]);
    return reply.header('cache-control', 'no-store').send({
      success: true,
      data: rows.map((row) => toRawPostDto(row.post, row.sessionCount)),
      meta: {
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / parsed.data.pageSize)),
        counts,
      },
    });
  });
}
