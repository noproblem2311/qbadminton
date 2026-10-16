import type { ExtractedPost } from '../types/messages';
import type { OutboxItem } from '../types/monitor';
import { ApiRequestError, type ApiClient } from './api.client';
import type { StorageService } from './storage.service';

export interface OutboxOptions {
  batchSize: number;
  /** Per-item attempt limit; a post still on the page is re-extracted after a refresh. */
  maxAttempts: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  maxQueue: number;
  maxSentKeys: number;
}

export const DEFAULT_OUTBOX_OPTIONS: OutboxOptions = {
  batchSize: 25,
  maxAttempts: 8,
  backoffBaseMs: 5_000,
  backoffMaxMs: 5 * 60_000,
  maxQueue: 1_000,
  maxSentKeys: 5_000,
};

export interface OutboxEvents {
  onSubmitted: (monitorId: string, count: number) => Promise<void> | void;
  onError: (monitorIds: Array<string | null>, message: string) => Promise<void> | void;
  /** Arrange for flush() to run again after `delayMs`. */
  scheduleRetry: (delayMs: number) => void;
}

export function backoffDelay(failures: number, options: Pick<OutboxOptions, 'backoffBaseMs' | 'backoffMaxMs'>): number {
  return Math.min(options.backoffMaxMs, options.backoffBaseMs * 2 ** Math.max(0, failures - 1));
}

/**
 * Persistent submission queue. Posts survive service-worker restarts, are sent in
 * batches, and failed submissions are retried with bounded exponential backoff.
 */
export class Outbox {
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly storage: StorageService,
    private readonly api: Pick<ApiClient, 'ingest'>,
    private readonly events: OutboxEvents,
    private readonly options: OutboxOptions = DEFAULT_OUTBOX_OPTIONS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Queue posts not yet acknowledged or queued. Returns how many were new. */
  async enqueue(posts: ExtractedPost[], monitorId: string | null): Promise<number> {
    const sent = new Set(await this.storage.get('sentKeys'));
    let added = 0;
    await this.storage.update('outbox', (queue) => {
      const queued = new Set(queue.map((item) => item.key));
      for (const { key, post } of posts) {
        if (sent.has(key) || queued.has(key)) continue;
        queued.add(key);
        queue.push({ key, post, monitorId, attempts: 0, enqueuedAt: new Date(this.now()).toISOString() });
        added += 1;
      }
      return queue.slice(-this.options.maxQueue);
    });
    return added;
  }

  flush(): Promise<void> {
    this.flushing ??= this.drain().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async drain(): Promise<void> {
    const retry = await this.storage.get('outboxRetry');
    if (retry.nextAttemptAt) {
      const wait = Date.parse(retry.nextAttemptAt) - this.now();
      if (wait > 0) {
        this.events.scheduleRetry(wait);
        return;
      }
    }

    let batchSize = this.options.batchSize;
    for (;;) {
      const batch = (await this.storage.get('outbox')).slice(0, batchSize);
      if (batch.length === 0) return;

      try {
        await this.api.ingest(batch.map((item) => item.post));
        await this.acknowledge(batch);
      } catch (error) {
        const failure =
          error instanceof ApiRequestError ? error : new ApiRequestError(String(error), null, true);
        if (!failure.retryable) {
          // A rejected batch: isolate the offending post by retrying one at a time.
          if (batch.length > 1) {
            batchSize = 1;
            continue;
          }
          await this.discard(batch, `Máy chủ từ chối bài viết: ${failure.message}`);
          continue;
        }
        await this.recordFailure(batch, failure.message);
        return;
      }
    }
  }

  private async acknowledge(batch: OutboxItem[]): Promise<void> {
    const keys = new Set(batch.map((item) => item.key));
    await this.storage.update('outbox', (queue) => queue.filter((item) => !keys.has(item.key)));
    await this.storage.update('sentKeys', (sent) => [...sent, ...keys].slice(-this.options.maxSentKeys));
    await this.storage.set('outboxRetry', { failures: 0, nextAttemptAt: null, lastError: null });

    const perMonitor = new Map<string, number>();
    for (const item of batch) {
      if (item.monitorId) perMonitor.set(item.monitorId, (perMonitor.get(item.monitorId) ?? 0) + 1);
    }
    for (const [monitorId, count] of perMonitor) await this.events.onSubmitted(monitorId, count);
  }

  private async discard(batch: OutboxItem[], message: string): Promise<void> {
    const keys = new Set(batch.map((item) => item.key));
    await this.storage.update('outbox', (queue) => queue.filter((item) => !keys.has(item.key)));
    await this.events.onError(batch.map((item) => item.monitorId), message);
  }

  private async recordFailure(batch: OutboxItem[], message: string): Promise<void> {
    const keys = new Set(batch.map((item) => item.key));
    const dropped: OutboxItem[] = [];
    await this.storage.update('outbox', (queue) =>
      queue.flatMap((item) => {
        if (!keys.has(item.key)) return [item];
        const attempts = item.attempts + 1;
        if (attempts >= this.options.maxAttempts) {
          dropped.push(item);
          return [];
        }
        return [{ ...item, attempts }];
      }),
    );

    const previous = await this.storage.get('outboxRetry');
    const failures = previous.failures + 1;
    const delay = backoffDelay(failures, this.options);
    await this.storage.set('outboxRetry', {
      failures,
      nextAttemptAt: new Date(this.now() + delay).toISOString(),
      lastError: message,
    });
    const suffix = dropped.length > 0 ? ` — bỏ ${dropped.length} bài sau ${this.options.maxAttempts} lần thử` : '';
    await this.events.onError(batch.map((item) => item.monitorId), `${message}${suffix}`);
    this.events.scheduleRetry(delay);
  }
}
