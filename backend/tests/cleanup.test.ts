import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { badmintonSessions, maintenanceRuns, rawPosts, sessionLevels } from '../src/database/schema.js';
import { CLEANUP_JOB, CleanupScheduler, cleanupOldData } from '../src/jobs/cleanup.js';
import { silentLogger } from '../src/lib/logger.js';
import { PostsRepository } from '../src/modules/posts/posts.repository.js';
import { toSessionInsert } from '../src/modules/sessions/sessions.mapper.js';
import { incomingPost } from './helpers/factories.js';
import { createTestDatabase } from './helpers/test-db.js';

// "Now" is 2026-10-20 12:00 in Vietnam, so the 2-day cutoff is 2026-10-18 12:00.
const NOW = new Date('2026-10-20T12:00:00+07:00');
const OLD_CAPTURE = new Date('2026-10-15T10:00:00+07:00');
const RECENT_CAPTURE = new Date('2026-10-19T10:00:00+07:00');

describe('old data cleanup', () => {
  let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
  let posts: PostsRepository;

  /** A raw post captured at `capturedAt` with sessions at the given local date/times. */
  async function seed(capturedAt: Date, sessions: Array<[string | null, string | null]>, status = 'parsed') {
    const { id } = await posts.ingest(incomingPost({ capturedAt }));
    await testDb.db
      .update(rawPosts)
      .set({ processingStatus: status as 'parsed' })
      .where(eq(rawPosts.id, id));
    const raw = (await posts.findById(id))!;
    for (const [playDate, startTime] of sessions) {
      const { row, levels } = toSessionInsert(raw, {
        author: raw.author,
        content: raw.content,
        playDate,
        startTime,
        endTime: null,
        level: 'TB',
        location: null,
      });
      const [session] = await testDb.db.insert(badmintonSessions).values(row).returning();
      await testDb.db.insert(sessionLevels).values(levels.map((levelCode) => ({ sessionId: session!.id, levelCode })));
    }
    return id;
  }

  const exists = async (id: string) => Boolean(await posts.findById(id));
  const sessionDates = async () =>
    (await testDb.db.select().from(badmintonSessions)).map((s) => s.playDate).sort();

  beforeAll(async () => {
    testDb = await createTestDatabase();
    posts = new PostsRepository(testDb.db);
  });
  beforeEach(() => testDb.reset());
  afterAll(() => testDb.close());

  it('deletes sessions and posts older than two days, keeping anything still relevant', async () => {
    const played = await seed(OLD_CAPTURE, [['2026-10-16', '19:00']]);
    const weekly = await seed(OLD_CAPTURE, [['2026-10-16', '19:00'], ['2026-10-22', '19:00']]);
    const irrelevant = await seed(OLD_CAPTURE, [], 'irrelevant');
    const recentPostOldSession = await seed(RECENT_CAPTURE, [['2026-10-15', '19:00']]);
    const inFlight = await seed(OLD_CAPTURE, [], 'processing');
    const undated = await seed(OLD_CAPTURE, [[null, null]]);
    await testDb.db.execute(sql`update badminton_sessions set created_at = ${OLD_CAPTURE.toISOString()}::timestamptz where play_date is null`);
    const yesterday = await seed(RECENT_CAPTURE, [['2026-10-19', '19:00']]);

    const result = await cleanupOldData(testDb.db, { retentionDays: 2, now: NOW });

    expect(result).toEqual({ cutoff: '2026-10-18T05:00:00.000Z', sessionsDeleted: 4, postsDeleted: 3 });
    expect(await exists(played)).toBe(false);
    expect(await exists(irrelevant)).toBe(false);
    expect(await exists(undated)).toBe(false);
    expect(await exists(weekly)).toBe(true); // still has the 22nd
    expect(await exists(recentPostOldSession)).toBe(true); // captured within two days
    expect(await exists(inFlight)).toBe(true); // a worker is on it
    expect(await exists(yesterday)).toBe(true);
    expect(await sessionDates()).toEqual(['2026-10-19', '2026-10-22']);
    expect(await testDb.db.select().from(sessionLevels)).toHaveLength(2);
  });

  it('is a no-op when nothing is old enough', async () => {
    await seed(RECENT_CAPTURE, [['2026-10-21', '19:00']]);
    expect(await cleanupOldData(testDb.db, { retentionDays: 2, now: NOW })).toMatchObject({
      sessionsDeleted: 0,
      postsDeleted: 0,
    });
  });

  describe('CleanupScheduler', () => {
    beforeEach(async () => {
      await testDb.db.delete(maintenanceRuns);
    });

    it('runs at once, then only after the interval has passed (persisted across restarts)', async () => {
      let clock = NOW;
      const make = () =>
        new CleanupScheduler(testDb.db, silentLogger, { retentionDays: 2, intervalHours: 48, now: () => clock });

      await seed(OLD_CAPTURE, [['2026-10-16', '19:00']]);
      expect(await make().runIfDue()).toMatchObject({ sessionsDeleted: 1, postsDeleted: 1 });

      const [run] = await testDb.db.select().from(maintenanceRuns).where(eq(maintenanceRuns.job, CLEANUP_JOB));
      expect(run?.lastRunAt.toISOString()).toBe(NOW.toISOString());

      // A "restarted" scheduler 47 hours later does not run again…
      clock = new Date(NOW.getTime() + 47 * 3_600_000);
      expect(await make().runIfDue()).toBeNull();

      // …but does once 48 hours have passed.
      clock = new Date(NOW.getTime() + 48 * 3_600_000);
      expect(await make().runIfDue()).toMatchObject({ sessionsDeleted: 0, postsDeleted: 0 });
    });
  });
});
