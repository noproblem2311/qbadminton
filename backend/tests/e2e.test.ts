import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ClaudeClient } from '../src/ai/claude.client.js';
import { ClaudePostSerializer } from '../src/ai/post.serializer.js';
import { buildApp } from '../src/app.js';
import { PostProcessor } from '../src/jobs/post-processor.js';
import { ProcessingWorker } from '../src/jobs/processing.worker.js';
import { silentLogger } from '../src/lib/logger.js';
import { addDays, toLocalDateTime } from '../src/lib/time.js';
import { PostsRepository } from '../src/modules/posts/posts.repository.js';
import { TEST_API_KEY, createTestDatabase } from './helpers/test-db.js';

/**
 * Backend end-to-end: extension-shaped payload → ingest API → raw_posts →
 * worker → (mocked) Claude → badminton_sessions → public sessions API.
 */
describe('ingest → process → list (mocked Claude)', () => {
  let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: ReturnType<typeof buildApp>;
  let worker: ProcessingWorker;
  const parse = vi.fn();

  const today = toLocalDateTime(new Date()).date;
  const nowIso = new Date().toISOString();
  const post = (postId: string, content: string) => ({
    postId,
    postUrl: `https://www.facebook.com/groups/caulongdanang/posts/${postId}/`,
    groupId: 'caulongdanang',
    author: 'Lê Văn C',
    content,
    publishedAt: nowIso,
    capturedAt: nowIso,
  });

  // Mocked Claude responses keyed by a marker in the post text.
  const responses: Record<string, unknown> = {
    UPCOMING: { relevant: true, sessions: [{ playDate: addDays(today, 1), startTime: '19h', endTime: '21h', level: 'TB+', location: 'Sân Tuyên Sơn' }] },
    EXPIRED: { relevant: true, sessions: [{ playDate: addDays(today, -1), startTime: '19:00', endTime: '21:00', level: 'TB', location: 'Sân Cũ' }] },
    SALE: { relevant: false, sessions: [] },
  };

  beforeAll(async () => {
    testDb = await createTestDatabase();
    parse.mockImplementation(async (params: { messages: Array<{ content: string }> }) => {
      const text = params.messages[0]?.content ?? '';
      const key = Object.keys(responses).find((marker) => text.includes(marker));
      return {
        stop_reason: 'end_turn',
        parsed_output: key ? responses[key] : { relevant: false, sessions: [] },
        usage: { input_tokens: 10, output_tokens: 10 },
      };
    });

    const posts = new PostsRepository(testDb.db);
    const serializer = new ClaudePostSerializer(
      new ClaudeClient({ parse } as never, 'claude-haiku-5-5'),
      silentLogger,
    );
    const processor = new PostProcessor(posts, serializer, silentLogger, {
      maxAttempts: 3,
      backoffBaseMs: 1_000,
      backoffMaxMs: 10_000,
    });
    worker = new ProcessingWorker(posts, processor, silentLogger, {
      concurrency: 2,
      pollIntervalMs: 60_000,
      staleAfterMs: 600_000,
      maxAttempts: 3,
    });
    app = buildApp({ db: testDb.db, ingestApiKey: TEST_API_KEY, onPostsAccepted: () => worker.notify() });
    worker.start();
  });

  afterAll(async () => {
    await worker.stop();
    await app.close();
    await testDb.close();
  });

  it('shows the upcoming session only, and ignores duplicates', async () => {
    const batch = [
      post('9001', 'UPCOMING: Tối mai sân Tuyên Sơn thiếu 2 nam TB+, 19h-21h'),
      post('9002', 'EXPIRED: Tối qua sân Cũ thiếu 1 nữ'),
      post('9003', 'SALE: Bán vợt Yonex Astrox 99, 1tr2'),
    ];
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/posts/ingest',
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload: { posts: batch },
    });
    expect(first.json().data).toMatchObject({ accepted: 3, duplicates: 0 });

    await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(3));

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/posts/ingest',
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload: { posts: [batch[0]] },
    });
    expect(duplicate.json().data).toMatchObject({ accepted: 0, duplicates: 1 });

    await vi.waitFor(async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/sessions' });
      const sessions = response.json().data;
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        author: 'Lê Văn C',
        playDate: addDays(today, 1),
        startTime: '19:00',
        endTime: '21:00',
        level: 'TB+',
        location: 'Sân Tuyên Sơn',
        postUrl: 'https://www.facebook.com/groups/caulongdanang/posts/9001/',
      });
    });

    // The duplicate never reached Claude again.
    expect(parse).toHaveBeenCalledTimes(3);
  });
});
