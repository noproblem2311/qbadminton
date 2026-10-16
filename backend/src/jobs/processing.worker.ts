import type { Logger } from '../lib/logger.js';
import type { PostsRepository } from '../modules/posts/posts.repository.js';
import type { PostProcessor } from './post-processor.js';

export interface WorkerOptions {
  concurrency: number;
  pollIntervalMs: number;
  staleAfterMs: number;
  maxAttempts: number;
}

/**
 * In-process, PostgreSQL-backed job loop. Jobs are claimed with SKIP LOCKED, so
 * several workers (or replicas) can run safely. `notify()` wakes it right after
 * ingestion; polling covers scheduled retries.
 */
export class ProcessingWorker {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private wakeRequested = false;
  private stopped = true;
  private stopping = false;
  private lastRecoveryAt = 0;

  constructor(
    private readonly posts: PostsRepository,
    private readonly processor: PostProcessor,
    private readonly logger: Logger,
    private readonly options: WorkerOptions,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.stopping = false;
    this.logger.info({ ...this.options }, 'processing worker started');
    this.notify();
  }

  /** Request a drain as soon as possible (coalesces concurrent requests). */
  notify(): void {
    if (this.stopped) return;
    if (this.running) {
      this.wakeRequested = true;
      return;
    }
    this.clearTimer();
    this.running = this.drain().finally(() => {
      this.running = null;
      if (this.stopped) return;
      if (this.wakeRequested) {
        this.wakeRequested = false;
        this.notify();
      } else {
        this.timer = setTimeout(() => this.notify(), this.options.pollIntervalMs);
      }
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.stopping = true;
    this.clearTimer();
    await this.running;
    this.logger.info('processing worker stopped');
  }

  /** Process due jobs until the queue is empty. Exposed for tests. */
  async drain(): Promise<void> {
    try {
      await this.recoverStaleIfDue();
      for (;;) {
        const batch = await this.posts.claimPending(this.options.concurrency);
        if (batch.length === 0) return;
        await Promise.all(batch.map((post) => this.processor.process(post)));
        if (this.stopping) return;
      }
    } catch (error) {
      this.logger.error({ err: error }, 'processing worker iteration failed');
    }
  }

  private async recoverStaleIfDue(): Promise<void> {
    const now = Date.now();
    if (now - this.lastRecoveryAt < Math.min(this.options.staleAfterMs, 60_000)) return;
    this.lastRecoveryAt = now;
    const recovered = await this.posts.recoverStale(this.options.staleAfterMs, this.options.maxAttempts);
    if (recovered > 0) this.logger.warn({ recovered }, 'recovered interrupted jobs');
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
