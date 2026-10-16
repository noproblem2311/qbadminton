import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { rawPosts } from '../src/database/schema.js';
import { PostsRepository } from '../src/modules/posts/posts.repository.js';
import { incomingPost, insertSession } from './helpers/factories.js';
import { TEST_API_KEY, createTestDatabase } from './helpers/test-db.js';

describe('GET /api/v1/posts (raw data)', () => {
  let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: ReturnType<typeof buildApp>;
  let posts: PostsRepository;

  const list = (query = '', apiKey: string | null = TEST_API_KEY) =>
    app.inject({
      method: 'GET',
      url: `/api/v1/posts${query}`,
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    });

  beforeAll(async () => {
    testDb = await createTestDatabase();
    app = buildApp({ db: testDb.db, ingestApiKey: TEST_API_KEY });
    posts = new PostsRepository(testDb.db);
  });
  beforeEach(() => testDb.reset());
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  it('requires the API key', async () => {
    expect((await list('', null)).statusCode).toBe(401);
    expect((await list('', 'wrong-key-wrong-key-wrong-key')).statusCode).toBe(401);
  });

  it('pages 30 posts at a time, newest first, with totals', async () => {
    for (let i = 0; i < 35; i += 1) await posts.ingest(incomingPost({ content: `Bài số ${i}` }));

    const first = (await list()).json();
    expect(first.data).toHaveLength(30);
    expect(first.meta).toMatchObject({ page: 1, pageSize: 30, total: 35, totalPages: 2 });
    expect(first.data[0].content).toBe('Bài số 34');

    const second = (await list('?page=2')).json();
    expect(second.data).toHaveLength(5);
    expect(second.data.at(-1).content).toBe('Bài số 0');

    const beyond = (await list('?page=9')).json();
    expect(beyond.data).toHaveLength(0);
  });

  it('filters by processing status and reports counts per status', async () => {
    const { id } = await posts.ingest(incomingPost());
    await posts.ingest(incomingPost());
    await testDb.db
      .update(rawPosts)
      .set({ processingStatus: 'failed', lastError: 'RateLimitError (429): slow down' })
      .where(eq(rawPosts.id, id));

    const failed = (await list('?status=failed')).json();
    expect(failed.data).toHaveLength(1);
    expect(failed.data[0]).toMatchObject({ id, processingStatus: 'failed', lastError: 'RateLimitError (429): slow down' });
    expect(failed.meta).toMatchObject({ total: 1, counts: { pending: 1, failed: 1, parsed: 0, processing: 0, irrelevant: 0 } });
  });

  it('includes the session count and a Facebook link, without internal fields', async () => {
    await insertSession(testDb.db, { playDate: '2026-10-16', startTime: '19:00' });
    const [post] = (await list()).json().data;
    expect(post).toMatchObject({
      sessionCount: 1,
      groupId: 'caulongdanang',
      postUrl: expect.stringMatching(/^https:\/\/www\.facebook\.com\/groups\/caulongdanang\/posts\/\d+\/$/u),
    });
    expect(post).not.toHaveProperty('fingerprint');
  });

  it('validates query parameters', async () => {
    expect((await list('?page=0')).statusCode).toBe(400);
    expect((await list('?pageSize=500')).statusCode).toBe(400);
    expect((await list('?status=done')).statusCode).toBe(400);
  });
});
