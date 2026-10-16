import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { BadmintonPost } from '../src/ai/post.schema.js';
import type { PostSerializer, SerializerResult } from '../src/ai/post.serializer.js';
import { badmintonSessions, rawPosts, sessionLevels } from '../src/database/schema.js';
import { dedupeExistingSessions } from '../src/jobs/dedupe-sessions.js';
import { PostProcessor } from '../src/jobs/post-processor.js';
import { silentLogger } from '../src/lib/logger.js';
import { PostsRepository } from '../src/modules/posts/posts.repository.js';
import { toSessionInsert } from '../src/modules/sessions/sessions.mapper.js';
import { incomingPost } from './helpers/factories.js';
import { createTestDatabase } from './helpers/test-db.js';

type Details = Omit<BadmintonPost, 'author' | 'content'>;
const BASE: Details = {
  playDate: '2026-10-16',
  startTime: '19:30',
  endTime: '21:30',
  level: 'TB-, TB',
  location: 'Sân CBC (642 Tôn Đức Thắng)',
};

describe('duplicate sessions', () => {
  let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
  let posts: PostsRepository;

  /** Ingest a post by `author` and run it through the processor with the given sessions. */
  async function process(author: string, sessions: Array<Partial<Details>>) {
    const { id } = await posts.ingest(incomingPost({ author, content: `${author} ${Math.random()}` }));
    const serializer: PostSerializer = {
      serialize: async (input): Promise<SerializerResult> => ({
        relevant: true,
        posts: sessions.map((s) => ({ ...BASE, ...s, author: input.author, content: input.content })),
      }),
    };
    const [claimed] = await posts.claimPending(1);
    const outcome = await new PostProcessor(posts, serializer, silentLogger, {
      maxAttempts: 3,
      backoffBaseMs: 1000,
      backoffMaxMs: 1000,
    }).process(claimed!);
    return { id, outcome, post: (await posts.findById(id))! };
  }

  const sessionCount = async () => (await testDb.db.select().from(badmintonSessions)).length;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    posts = new PostsRepository(testDb.db);
  });
  beforeEach(() => testDb.reset());
  afterAll(() => testDb.close());

  it('skips a session that matches author, levels, location and time, and marks the post', async () => {
    const first = await process('Đạt Trần', [{}]);
    // Same session written differently: other level spelling, casing and accents of the venue.
    const second = await process('Đạt Trần', [{ level: 'TB/TB-', location: 'sân cbc (642 ton duc thang)' }]);

    expect(first.outcome).toBe('parsed');
    expect(second.outcome).toBe('duplicate');
    expect(second.post).toMatchObject({ processingStatus: 'duplicate', duplicateOfPostId: first.id });
    expect(await sessionCount()).toBe(1);
  });

  it.each([
    ['author', { author: 'Người khác' }],
    ['levels', { level: 'TB+' }],
    ['location', { location: 'Sân Chi Lăng' }],
    ['date', { playDate: '2026-10-17' }],
    ['start time', { startTime: '19:00' }],
    ['end time', { endTime: '22:00' }],
  ])('keeps sessions that differ only by %s', async (_label, change) => {
    await process('Đạt Trần', [{}]);
    const { author, ...details } = change as Partial<Details> & { author?: string };
    const other = await process(author ?? 'Đạt Trần', [details]);
    expect(other.outcome).toBe('parsed');
    expect(await sessionCount()).toBe(2);
  });

  it('stores only the new sessions of a partly duplicated post', async () => {
    await process('Đạt Trần', [{}]);
    const mixed = await process('Đạt Trần', [{}, { playDate: '2026-10-18' }]);
    expect(mixed.outcome).toBe('parsed');
    expect(mixed.post.processingStatus).toBe('parsed');
    expect(await sessionCount()).toBe(2);
  });

  it('removes duplicates that were stored before the check existed', async () => {
    const insertRaw = async () => {
      const { id } = await posts.ingest(incomingPost({ author: 'Minh Thảo Nguyễn' }));
      await testDb.db.update(rawPosts).set({ processingStatus: 'parsed' }).where(eq(rawPosts.id, id));
      const raw = (await posts.findById(id))!;
      const { row, levels } = toSessionInsert(raw, { ...BASE, author: raw.author, content: raw.content });
      const [session] = await testDb.db.insert(badmintonSessions).values(row).returning();
      await testDb.db.insert(sessionLevels).values(levels.map((levelCode) => ({ sessionId: session!.id, levelCode })));
      return id;
    };
    const keep = await insertRaw();
    const extra = await insertRaw();
    await process('Someone Else', [{}]); // same session, different author: not a duplicate

    expect(await dedupeExistingSessions(testDb.db)).toEqual({ sessionsDeleted: 1, postsMarkedDuplicate: 1 });
    expect(await sessionCount()).toBe(2);
    expect(await posts.findById(extra)).toMatchObject({ processingStatus: 'duplicate', duplicateOfPostId: keep });
    expect((await posts.findById(keep))?.processingStatus).toBe('parsed');
    expect(await dedupeExistingSessions(testDb.db)).toEqual({ sessionsDeleted: 0, postsMarkedDuplicate: 0 });
  });
});
