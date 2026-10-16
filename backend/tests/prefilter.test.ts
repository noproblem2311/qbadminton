import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostSerializer } from '../src/ai/post.serializer.js';
import { PostProcessor } from '../src/jobs/post-processor.js';
import { silentLogger } from '../src/lib/logger.js';
import { PASS_SKIP_REASON, preAiSkipReason } from '../src/lib/prefilter.js';
import { PostsRepository } from '../src/modules/posts/posts.repository.js';
import { incomingPost } from './helpers/factories.js';
import { createTestDatabase } from './helpers/test-db.js';

describe('preAiSkipReason', () => {
  it.each([
    'Pass sân tầng 1 ĐH TDTT suất 19h-21h ngày 15/10',
    'GÓC PASS SÂN / Sân Vip Beta Era',
    'Tìm sân pass tối nay 19h',
    'Góc pass vợt Yonex 100zz',
    'Ai pass đôi này k ạ',
    'giá pass: 180k',
    '(pass) sân Chi Lăng',
  ])('skips "%s"', (content) => {
    expect(preAiSkipReason(content)).toBe(PASS_SKIP_REASON);
  });

  it.each([
    'Tối nay sân Tuyên Sơn thiếu 2 nam trình TB+, 19h-21h',
    'Quên password wifi sân rồi',
    'Đi bypass Hòa Cầm',
    'Sân Compass Arena tuyển vãng lai',
    'passport',
  ])('sends "%s" to the AI', (content) => {
    expect(preAiSkipReason(content)).toBeNull();
  });
});

describe('PostProcessor pre-AI rule', () => {
  let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
  let posts: PostsRepository;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    posts = new PostsRepository(testDb.db);
  });
  beforeEach(() => testDb.reset());
  afterAll(() => testDb.close());

  it('marks "pass" posts irrelevant without calling the AI', async () => {
    const { id } = await posts.ingest(incomingPost({ content: 'Pass sân beta 17-19h hôm nay. Inbox giúp nhé!' }));
    const serialize = vi.fn();
    const processor = new PostProcessor(posts, { serialize } as unknown as PostSerializer, silentLogger, {
      maxAttempts: 3,
      backoffBaseMs: 1000,
      backoffMaxMs: 1000,
    });

    const [claimed] = await posts.claimPending(1);
    expect(await processor.process(claimed!)).toBe('irrelevant');
    expect(serialize).not.toHaveBeenCalled();
    expect(await posts.findById(id)).toMatchObject({ processingStatus: 'irrelevant', skipReason: PASS_SKIP_REASON });
  });
});
