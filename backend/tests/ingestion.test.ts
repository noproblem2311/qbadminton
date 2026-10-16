import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { rawPosts } from '../src/database/schema.js';
import { rawPostPayload } from './helpers/factories.js';
import { TEST_API_KEY, createTestDatabase } from './helpers/test-db.js';

describe('POST /api/v1/posts/ingest', () => {
  let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: ReturnType<typeof buildApp>;
  const onPostsAccepted = vi.fn();

  const ingest = (body: unknown, apiKey: string | null = TEST_API_KEY) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/posts/ingest',
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      payload: body as Record<string, unknown>,
    });

  beforeAll(async () => {
    testDb = await createTestDatabase();
    app = buildApp({ db: testDb.db, ingestApiKey: TEST_API_KEY, onPostsAccepted });
  });
  beforeEach(async () => {
    await testDb.reset();
    onPostsAccepted.mockClear();
  });
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  describe('authentication', () => {
    it('rejects requests without an API key', async () => {
      const response = await ingest({ posts: [rawPostPayload()] }, null);
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing or invalid API key' },
      });
    });

    it('rejects a wrong API key', async () => {
      const response = await ingest({ posts: [rawPostPayload()] }, 'wrong-key-wrong-key-wrong-key');
      expect(response.statusCode).toBe(401);
    });

    it('accepts the X-API-Key header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/posts/ingest',
        headers: { 'x-api-key': TEST_API_KEY },
        payload: { posts: [rawPostPayload()] },
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('validation', () => {
    it.each([
      ['empty batch', { posts: [] }],
      ['missing posts', {}],
      ['blank content', { posts: [rawPostPayload({ content: '   \n ' })] }],
      ['non-facebook URL', { posts: [rawPostPayload({ postUrl: 'https://evil.example.com/x' })] }],
      ['bad timestamp', { posts: [rawPostPayload({ capturedAt: 'yesterday' })] }],
      ['bad post id', { posts: [rawPostPayload({ postId: '<script>' })] }],
    ])('rejects %s with 400', async (_label, body) => {
      const response = await ingest(body);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects batches over 50 posts', async () => {
      const posts = Array.from({ length: 51 }, () => rawPostPayload());
      expect((await ingest({ posts })).statusCode).toBe(400);
    });

    it('accepts null optional fields', async () => {
      const response = await ingest({
        posts: [rawPostPayload({ postId: null, postUrl: null, author: null, publishedAt: null })],
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.accepted).toBe(1);
    });
  });

  describe('storage and deduplication', () => {
    it('stores new posts as pending and wakes the worker', async () => {
      const payload = rawPostPayload();
      const response = await ingest({ posts: [payload] });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        success: true,
        data: { received: 1, accepted: 1, duplicates: 0, results: [{ index: 0, status: 'accepted' }] },
      });
      expect(onPostsAccepted).toHaveBeenCalledTimes(1);

      const [row] = await testDb.db.select().from(rawPosts);
      expect(row).toMatchObject({
        facebookPostId: payload.postId,
        groupId: 'caulongdanang',
        author: 'Nguyễn Văn A',
        content: payload.content,
        processingStatus: 'pending',
        processingAttempts: 0,
      });
      expect(row?.publishedAt?.toISOString()).toBe('2026-10-15T03:00:00.000Z');
      expect(row?.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    });

    it('is idempotent on group ID + post ID', async () => {
      const payload = rawPostPayload();
      const first = await ingest({ posts: [payload] });
      const second = await ingest({ posts: [{ ...payload, content: `${payload.content} (edited)` }] });

      expect(second.json().data).toMatchObject({ accepted: 0, duplicates: 1 });
      expect(second.json().data.results[0].id).toBe(first.json().data.results[0].id);
      expect(await testDb.db.select().from(rawPosts)).toHaveLength(1);
      expect(onPostsAccepted).toHaveBeenCalledTimes(1);
    });

    it('treats the same post ID in a different group as a different post', async () => {
      const payload = rawPostPayload();
      await ingest({ posts: [payload] });
      const other = await ingest({ posts: [{ ...payload, groupId: 'othergroup' }] });
      expect(other.json().data.accepted).toBe(1);
    });

    it('falls back to the content fingerprint when the post ID is missing', async () => {
      const base = rawPostPayload({ postId: null, postUrl: null });
      await ingest({ posts: [base] });
      const reformatted = await ingest({
        posts: [{ ...base, content: `  ${base.content.toUpperCase()}  … Xem thêm`, capturedAt: '2026-10-15T11:00:00+07:00' }],
      });
      const different = await ingest({ posts: [{ ...base, content: 'Một bài hoàn toàn khác' }] });

      expect(reformatted.json().data.duplicates).toBe(1);
      expect(different.json().data.accepted).toBe(1);
    });

    it('upgrades a fingerprint-only row when the post ID shows up later', async () => {
      const base = rawPostPayload({ postId: null, postUrl: null, publishedAt: null });
      await ingest({ posts: [base] });
      const withId = await ingest({
        posts: [
          {
            ...base,
            postId: '999888777666',
            postUrl: 'https://www.facebook.com/groups/caulongdanang/posts/999888777666/',
            publishedAt: '2026-10-15T11:28:00+07:00',
          },
        ],
      });

      expect(withId.json().data.duplicates).toBe(1);
      const rows = await testDb.db.select().from(rawPosts);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.facebookPostId).toBe('999888777666');
      expect(rows[0]?.postUrl).toBe('https://www.facebook.com/groups/caulongdanang/posts/999888777666/');
      expect(rows[0]?.publishedAt?.toISOString()).toBe('2026-10-15T04:28:00.000Z');
    });

    it('ignores a post ID-less re-capture of a post already stored with its ID', async () => {
      const payload = rawPostPayload();
      await ingest({ posts: [payload] });
      const again = await ingest({ posts: [{ ...payload, postId: null, postUrl: null }] });
      expect(again.json().data.duplicates).toBe(1);
    });

    it('dedupes within a single batch and under concurrent requests', async () => {
      const payload = rawPostPayload();
      const batch = await ingest({ posts: [payload, payload] });
      expect(batch.json().data).toMatchObject({ accepted: 1, duplicates: 1 });

      const fresh = rawPostPayload({ postId: null, postUrl: null });
      const responses = await Promise.all([1, 2, 3].map(() => ingest({ posts: [fresh] })));
      const accepted = responses.reduce((sum, r) => sum + r.json().data.accepted, 0);
      expect(accepted).toBe(1);
    });
  });
});
