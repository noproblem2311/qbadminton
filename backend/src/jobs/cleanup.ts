import { and, eq, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { Database } from '../database/client.js';
import { badmintonSessions, maintenanceRuns, rawPosts } from '../database/schema.js';
import type { Logger } from '../lib/logger.js';

export const CLEANUP_JOB = 'cleanup-old-data';

export interface CleanupResult {
  cutoff: string;
  sessionsDeleted: number;
  postsDeleted: number;
}

/**
 * Delete data older than the retention window:
 *  - sessions that started before the cutoff (or, without a start time, were created before it);
 *    their session_levels go with them (ON DELETE CASCADE);
 *  - raw posts captured before the cutoff that no longer have any session, unless a worker is
 *    processing them right now. A post that still has an upcoming session is kept.
 */
export async function cleanupOldData(
  db: Database,
  options: { retentionDays: number; now?: Date },
): Promise<CleanupResult> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - options.retentionDays * 86_400_000);

  return db.transaction(async (tx) => {
    const sessions = await tx
      .delete(badmintonSessions)
      .where(
        or(
          lt(badmintonSessions.startsAt, cutoff),
          and(isNull(badmintonSessions.startsAt), lt(badmintonSessions.createdAt, cutoff)),
        ),
      )
      .returning({ id: badmintonSessions.id });

    const posts = await tx
      .delete(rawPosts)
      .where(
        and(
          lt(rawPosts.capturedAt, cutoff),
          ne(rawPosts.processingStatus, 'processing'),
          // Qualified explicitly so the subquery cannot resolve "id" to badminton_sessions.id.
          sql`not exists (select 1 from badminton_sessions s where s.raw_post_id = "raw_posts"."id")`,
        ),
      )
      .returning({ id: rawPosts.id });

    return { cutoff: cutoff.toISOString(), sessionsDeleted: sessions.length, postsDeleted: posts.length };
  });
}

export interface CleanupSchedulerOptions {
  retentionDays: number;
  /** Minimum time between runs. */
  intervalHours: number;
  /** How often to check whether a run is due. */
  checkEveryMs?: number;
  now?: () => Date;
}

/**
 * Runs cleanupOldData every `intervalHours`. The last run is stored in maintenance_runs,
 * so restarts neither repeat a recent run nor skip a due one.
 */
export class CleanupScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
    private readonly options: CleanupSchedulerOptions,
  ) {}

  start(): void {
    if (this.timer) return;
    void this.runIfDue();
    this.timer = setInterval(() => void this.runIfDue(), this.options.checkEveryMs ?? 30 * 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Run the cleanup if the interval has elapsed since the last run. Exposed for tests. */
  async runIfDue(): Promise<CleanupResult | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const now = this.options.now?.() ?? new Date();
      const [last] = await this.db
        .select()
        .from(maintenanceRuns)
        .where(eq(maintenanceRuns.job, CLEANUP_JOB))
        .limit(1);
      if (last && now.getTime() - last.lastRunAt.getTime() < this.options.intervalHours * 3_600_000) return null;

      const result = await cleanupOldData(this.db, { retentionDays: this.options.retentionDays, now });
      const details = JSON.stringify(result);
      await this.db
        .insert(maintenanceRuns)
        .values({ job: CLEANUP_JOB, lastRunAt: now, details })
        .onConflictDoUpdate({ target: maintenanceRuns.job, set: { lastRunAt: now, details } });
      this.logger.info({ ...result, retentionDays: this.options.retentionDays }, 'old data cleanup finished');
      return result;
    } catch (error) {
      this.logger.error({ err: error }, 'old data cleanup failed');
      return null;
    } finally {
      this.running = false;
    }
  }
}
