import { describeError, isRetryableError } from '../ai/claude.client.js';
import type { PostSerializer } from '../ai/post.serializer.js';
import type { RawPost } from '../database/schema.js';
import type { Logger } from '../lib/logger.js';
import { preAiSkipReason } from '../lib/prefilter.js';
import type { JobClaim, PostsRepository } from '../modules/posts/posts.repository.js';
import { toSessionInsert } from '../modules/sessions/sessions.mapper.js';
import { computeBackoffMs } from './backoff.js';

export type ProcessingOutcome = 'parsed' | 'duplicate' | 'irrelevant' | 'retry' | 'failed' | 'lost-claim';

export interface PostProcessorOptions {
  maxAttempts: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  now?: () => Date;
  random?: () => number;
}

/** Runs one claimed raw post through the serializer and records the result. */
export class PostProcessor {
  constructor(
    private readonly posts: PostsRepository,
    private readonly serializer: PostSerializer,
    private readonly logger: Logger,
    private readonly options: PostProcessorOptions,
  ) {}

  async process(post: RawPost): Promise<ProcessingOutcome> {
    const claim: JobClaim = { id: post.id, attempt: post.processingAttempts };
    const log = { rawPostId: post.id, attempt: claim.attempt };

    // Rules that settle the post without spending an AI call.
    const skipReason = preAiSkipReason(post.content);
    if (skipReason) {
      const done = await this.posts.completeIrrelevant(claim, skipReason);
      if (done) this.logger.info({ ...log, skipReason }, 'post skipped before AI');
      return done ? 'irrelevant' : 'lost-claim';
    }

    let outcome: ProcessingOutcome;
    try {
      const result = await this.serializer.serialize({
        author: post.author,
        content: post.content,
        publishedAt: post.publishedAt,
        capturedAt: post.capturedAt,
      });

      if (!result.relevant) {
        outcome = (await this.posts.completeIrrelevant(claim)) ? 'irrelevant' : 'lost-claim';
      } else {
        const rows = result.posts.map((parsed) => toSessionInsert(post, parsed));
        const saved = await this.posts.completeParsed(claim, rows);
        outcome = saved?.status ?? 'lost-claim';
        if (saved) {
          this.logger.info(
            { ...log, sessions: saved.inserted, duplicatesSkipped: saved.skipped },
            saved.status === 'duplicate' ? 'post is a duplicate' : 'post parsed',
          );
        }
      }
    } catch (error) {
      outcome = await this.handleFailure(claim, error);
    }

    if (outcome === 'lost-claim') {
      this.logger.warn(log, 'job was reclaimed by another worker; result discarded');
    }
    return outcome;
  }

  private async handleFailure(claim: JobClaim, error: unknown): Promise<ProcessingOutcome> {
    // Postgres text cannot store NUL; error messages may echo query parameters.
    const message = describeError(error).replaceAll('\u0000', '').slice(0, 1000);
    const retryable = isRetryableError(error);
    const log = { rawPostId: claim.id, attempt: claim.attempt, retryable, error: message };

    if (retryable && claim.attempt < this.options.maxAttempts) {
      const delayMs = computeBackoffMs(claim.attempt, {
        baseMs: this.options.backoffBaseMs,
        maxMs: this.options.backoffMaxMs,
        random: this.options.random,
      });
      const now = this.options.now?.() ?? new Date();
      const nextAttemptAt = new Date(now.getTime() + delayMs);
      this.logger.warn({ ...log, nextAttemptAt }, 'post processing failed; retry scheduled');
      return (await this.posts.scheduleRetry(claim, nextAttemptAt, message)) ? 'retry' : 'lost-claim';
    }

    this.logger.error(log, 'post processing failed permanently');
    return (await this.posts.fail(claim, message)) ? 'failed' : 'lost-claim';
  }
}
