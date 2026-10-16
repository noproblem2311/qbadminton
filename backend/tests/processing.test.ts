import Anthropic from '@anthropic-ai/sdk';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeOutputError } from '../src/ai/claude.client.js';
import type { PostSerializer, SerializerInput, SerializerResult } from '../src/ai/post.serializer.js';
import { badmintonSessions, rawPosts, sessionLevels } from '../src/database/schema.js';
import { computeBackoffMs } from '../src/jobs/backoff.js';
import { PostProcessor } from '../src/jobs/post-processor.js';
import { ProcessingWorker } from '../src/jobs/processing.worker.js';
import { silentLogger } from '../src/lib/logger.js';
import { PostsRepository } from '../src/modules/posts/posts.repository.js';
import { incomingPost } from './helpers/factories.js';
import { createTestDatabase } from './helpers/test-db.js';

const parsedResult = (input: SerializerInput): SerializerResult => ({
  relevant: true,
  posts: [
    {
      author: input.author,
      content: input.content,
      playDate: '2026-10-16',
      startTime: '18:00',
      endTime: '20:00',
      level: 'TB',
      location: 'Sân Chi Lăng',
    },
  ],
});

class FakeSerializer implements PostSerializer {
  calls: SerializerInput[] = [];
  constructor(private readonly impl: (input: SerializerInput) => Promise<SerializerResult>) {}
  serialize(input: SerializerInput) {
    this.calls.push(input);
    return this.impl(input);
  }
}

const OPTIONS = { maxAttempts: 3, backoffBaseMs: 1_000, backoffMaxMs: 60_000, random: () => 0.5 };

describe('PostgreSQL-backed processing queue', () => {
  let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
  let posts: PostsRepository;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    posts = new PostsRepository(testDb.db);
  });
  beforeEach(() => testDb.reset());
  afterAll(() => testDb.close());

  const statusOf = async (id: string) => (await posts.findById(id))?.processingStatus;

  describe('claiming', () => {
    it('claims due pending posts, marks them processing and counts the attempt', async () => {
      const { id } = await posts.ingest(incomingPost());
      const claimed = await posts.claimPending(5);

      expect(claimed).toHaveLength(1);
      expect(claimed[0]).toMatchObject({ id, processingStatus: 'processing', processingAttempts: 1 });
      expect(claimed[0]?.processingStartedAt).toBeInstanceOf(Date);
      expect(await posts.claimPending(5)).toHaveLength(0);
    });

    it('skips posts whose retry time has not arrived', async () => {
      const { id } = await posts.ingest(incomingPost());
      await testDb.db
        .update(rawPosts)
        .set({ nextAttemptAt: sql`now() + interval '1 hour'` })
        .where(eq(rawPosts.id, id));
      expect(await posts.claimPending(5)).toHaveLength(0);
    });

    it('never hands the same post to two concurrent claimers', async () => {
      for (let i = 0; i < 4; i += 1) await posts.ingest(incomingPost());
      const [a, b] = await Promise.all([posts.claimPending(3), posts.claimPending(3)]);
      const ids = [...(a ?? []), ...(b ?? [])].map((post) => post.id);
      expect(ids).toHaveLength(4);
      expect(new Set(ids).size).toBe(4);
    });
  });

  describe('recovery of interrupted jobs', () => {
    it('returns stale processing jobs to pending, or fails them at the attempt limit', async () => {
      const first = await posts.ingest(incomingPost());
      const second = await posts.ingest(incomingPost());
      await posts.claimPending(5);
      await testDb.db
        .update(rawPosts)
        .set({ processingStartedAt: sql`now() - interval '1 hour'` })
        .where(eq(rawPosts.id, first.id));
      await testDb.db
        .update(rawPosts)
        .set({ processingStartedAt: sql`now() - interval '1 hour'`, processingAttempts: 3 })
        .where(eq(rawPosts.id, second.id));

      expect(await posts.recoverStale(10 * 60_000, 3)).toBe(2);
      expect(await statusOf(first.id)).toBe('pending');
      expect(await statusOf(second.id)).toBe('failed');
      expect((await posts.findById(first.id))?.lastError).toMatch(/interrupted/u);
    });

    it('leaves recently claimed jobs alone', async () => {
      await posts.ingest(incomingPost());
      await posts.claimPending(5);
      expect(await posts.recoverStale(10 * 60_000, 3)).toBe(0);
    });
  });

  describe('PostProcessor', () => {
    const processorWith = (serializer: PostSerializer) =>
      new PostProcessor(posts, serializer, silentLogger, OPTIONS);

    it('stores sessions and marks the post parsed', async () => {
      const { id } = await posts.ingest(incomingPost());
      const [claimed] = await posts.claimPending(1);
      const outcome = await processorWith(new FakeSerializer(async (i) => parsedResult(i))).process(claimed!);

      expect(outcome).toBe('parsed');
      expect(await statusOf(id)).toBe('parsed');
      const sessions = await testDb.db.select().from(badmintonSessions);
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        rawPostId: id,
        author: 'Trần Thị B',
        playDate: '2026-10-16',
        startTime: '18:00:00',
        level: 'TB',
        location: 'Sân Chi Lăng',
        locationSearch: 'san chi lang',
      });
      expect(sessions[0]?.startsAt?.toISOString()).toBe('2026-10-16T11:00:00.000Z');
      const levels = await testDb.db.select().from(sessionLevels);
      expect(levels).toEqual([{ sessionId: sessions[0]?.id, levelCode: 'TB' }]);
    });

    it('marks irrelevant posts without creating sessions', async () => {
      const { id } = await posts.ingest(incomingPost({ content: 'Bán vợt Yonex 90% giá 1tr' }));
      const [claimed] = await posts.claimPending(1);
      const outcome = await processorWith(new FakeSerializer(async () => ({ relevant: false }))).process(claimed!);

      expect(outcome).toBe('irrelevant');
      expect(await statusOf(id)).toBe('irrelevant');
      expect(await testDb.db.select().from(badmintonSessions)).toHaveLength(0);
    });

    it('schedules a retry with exponential backoff on retryable errors', async () => {
      const { id } = await posts.ingest(incomingPost());
      const [claimed] = await posts.claimPending(1);
      const rateLimited = new Anthropic.RateLimitError(429, undefined, 'rate limited', new Headers());
      const now = new Date('2030-01-01T00:00:00Z');
      const processor = new PostProcessor(
        posts,
        new FakeSerializer(async () => Promise.reject(rateLimited)),
        silentLogger,
        { ...OPTIONS, now: () => now },
      );

      expect(await processor.process(claimed!)).toBe('retry');
      const row = await posts.findById(id);
      expect(row?.processingStatus).toBe('pending');
      expect(row?.nextAttemptAt.getTime()).toBe(now.getTime() + 1_000);
      expect(row?.lastError).toMatch(/429/u);
    });

    it('fails permanently on non-retryable errors', async () => {
      const { id } = await posts.ingest(incomingPost());
      const [claimed] = await posts.claimPending(1);
      const refusal = new ClaudeOutputError('Claude declined to process the post', false);
      expect(await processorWith(new FakeSerializer(() => Promise.reject(refusal))).process(claimed!)).toBe('failed');
      expect(await statusOf(id)).toBe('failed');
    });

    it('fails after the maximum number of attempts', async () => {
      const { id } = await posts.ingest(incomingPost());
      const failing = processorWith(new FakeSerializer(() => Promise.reject(new Error('boom'))));

      for (let attempt = 1; attempt <= OPTIONS.maxAttempts; attempt += 1) {
        await testDb.db.update(rawPosts).set({ nextAttemptAt: sql`now()` }).where(eq(rawPosts.id, id));
        const [claimed] = await posts.claimPending(1);
        expect(claimed?.processingAttempts).toBe(attempt);
        const outcome = await failing.process(claimed!);
        expect(outcome).toBe(attempt < OPTIONS.maxAttempts ? 'retry' : 'failed');
      }
      expect(await statusOf(id)).toBe('failed');
    });

    it('discards the result of a worker whose claim was taken over', async () => {
      const { id } = await posts.ingest(incomingPost());
      const [staleClaim] = await posts.claimPending(1);
      // Simulate stale recovery followed by another worker reclaiming the job.
      await testDb.db
        .update(rawPosts)
        .set({ processingStatus: 'pending', nextAttemptAt: sql`now()` })
        .where(eq(rawPosts.id, id));
      await posts.claimPending(1);

      const outcome = await processorWith(new FakeSerializer(async (i) => parsedResult(i))).process(staleClaim!);
      expect(outcome).toBe('lost-claim');
      expect(await testDb.db.select().from(badmintonSessions)).toHaveLength(0);
      expect(await statusOf(id)).toBe('processing');
    });
  });

  describe('ProcessingWorker', () => {
    const workerWith = (serializer: PostSerializer) =>
      new ProcessingWorker(posts, new PostProcessor(posts, serializer, silentLogger, OPTIONS), silentLogger, {
        concurrency: 2,
        pollIntervalMs: 60_000,
        staleAfterMs: 10 * 60_000,
        maxAttempts: OPTIONS.maxAttempts,
      });

    it('drains the queue and never reprocesses finished posts', async () => {
      for (let i = 0; i < 5; i += 1) await posts.ingest(incomingPost());
      // A distinct venue per post, so none of them is a duplicate of another.
      const serializer = new FakeSerializer(async (i) => {
        const result = parsedResult(i);
        return result.relevant ? { relevant: true, posts: result.posts.map((p) => ({ ...p, location: i.content })) } : result;
      });
      const worker = workerWith(serializer);

      await worker.drain();
      expect(serializer.calls).toHaveLength(5);
      expect(await testDb.db.select().from(badmintonSessions)).toHaveLength(5);

      await worker.drain();
      expect(serializer.calls).toHaveLength(5);
    });

    it('processes posts after notify() and stops cleanly', async () => {
      const { id } = await posts.ingest(incomingPost());
      const worker = workerWith(new FakeSerializer(async (i) => parsedResult(i)));
      worker.start();
      await vi.waitFor(async () => expect(await statusOf(id)).toBe('parsed'));
      await worker.stop();
    });
  });
});

describe('computeBackoffMs', () => {
  it('doubles per attempt, applies jitter and respects the cap', () => {
    const fixed = { baseMs: 1_000, maxMs: 10_000, random: () => 0.5 };
    expect([1, 2, 3, 4, 5].map((n) => computeBackoffMs(n, fixed))).toEqual([1_000, 2_000, 4_000, 8_000, 10_000]);
    expect(computeBackoffMs(1, { ...fixed, random: () => 0 })).toBe(800);
    expect(computeBackoffMs(1, { ...fixed, random: () => 1 })).toBe(1_200);
  });
});
