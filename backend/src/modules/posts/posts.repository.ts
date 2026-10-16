import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { Database } from '../../database/client.js';
import {
  badmintonSessions,
  processingStatusEnum,
  rawPosts,
  sessionLevels,
  type LevelCode,
  type NewBadmintonSession,
  type ProcessingStatus,
  type RawPost,
} from '../../database/schema.js';
import { computeFingerprint } from '../../lib/text.js';
import { duplicateKey, findDuplicateSession } from '../sessions/session-dedup.js';

export interface IncomingRawPost {
  postId: string | null;
  postUrl: string | null;
  groupId: string | null;
  author: string | null;
  content: string;
  publishedAt: Date | null;
  capturedAt: Date;
}

export interface IngestOutcome {
  status: 'accepted' | 'duplicate';
  id: string;
}

export interface CompleteParsedResult {
  status: 'parsed' | 'duplicate';
  /** Sessions stored. */
  inserted: number;
  /** Sessions skipped as duplicates of stored ones. */
  skipped: number;
}

/** Identifies one claim of a job so a stale worker cannot overwrite a newer claim. */
export interface JobClaim {
  id: string;
  attempt: number;
}

export class PostsRepository {
  constructor(private readonly db: Database) {}

  /**
   * Idempotently store one raw post. Dedup order:
   *  1. same (group, Facebook post ID) → duplicate
   *  2. a fingerprint-only row for the same content gains the post ID → duplicate
   *  3. no post ID and the fingerprint is already known → duplicate
   * An advisory lock on the fingerprint serializes concurrent submissions of the same post.
   */
  async ingest(post: IncomingRawPost): Promise<IngestOutcome> {
    const fingerprint = computeFingerprint(post);
    const groupKey = post.groupId ?? '';

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${fingerprint}))`);

      if (post.postId) {
        const [existing] = await tx
          .select({ id: rawPosts.id })
          .from(rawPosts)
          .where(
            and(
              eq(rawPosts.facebookPostId, post.postId),
              sql`coalesce(${rawPosts.groupId}, '') = ${groupKey}`,
            ),
          )
          .limit(1);
        if (existing) return { status: 'duplicate', id: existing.id };

        const [upgraded] = await tx
          .update(rawPosts)
          .set({
            facebookPostId: post.postId,
            postUrl: sql`coalesce(${rawPosts.postUrl}, ${post.postUrl})`,
            publishedAt: sql`coalesce(${rawPosts.publishedAt}, ${post.publishedAt?.toISOString() ?? null}::timestamptz)`,
            updatedAt: sql`now()`,
          })
          .where(and(eq(rawPosts.fingerprint, fingerprint), isNull(rawPosts.facebookPostId)))
          .returning({ id: rawPosts.id });
        if (upgraded) return { status: 'duplicate', id: upgraded.id };
      } else {
        const [existing] = await tx
          .select({ id: rawPosts.id })
          .from(rawPosts)
          .where(eq(rawPosts.fingerprint, fingerprint))
          .limit(1);
        if (existing) return { status: 'duplicate', id: existing.id };
      }

      const [inserted] = await tx
        .insert(rawPosts)
        .values({
          facebookPostId: post.postId,
          groupId: post.groupId,
          postUrl: post.postUrl,
          author: post.author,
          content: post.content,
          publishedAt: post.publishedAt,
          capturedAt: post.capturedAt,
          fingerprint,
        })
        .onConflictDoNothing()
        .returning({ id: rawPosts.id });
      if (inserted) return { status: 'accepted', id: inserted.id };

      // Lost a race on the (group, post ID) unique index.
      const [winner] = await tx
        .select({ id: rawPosts.id })
        .from(rawPosts)
        .where(
          post.postId
            ? and(
                eq(rawPosts.facebookPostId, post.postId),
                sql`coalesce(${rawPosts.groupId}, '') = ${groupKey}`,
              )
            : eq(rawPosts.fingerprint, fingerprint),
        )
        .limit(1);
      if (!winner) throw new Error('Insert conflicted but no existing row was found');
      return { status: 'duplicate', id: winner.id };
    });
  }

  /** Atomically claim due pending jobs; concurrent workers never receive the same row. */
  async claimPending(limit: number): Promise<RawPost[]> {
    const due = this.db
      .select({ id: rawPosts.id })
      .from(rawPosts)
      .where(and(eq(rawPosts.processingStatus, 'pending'), lte(rawPosts.nextAttemptAt, sql`now()`)))
      .orderBy(asc(rawPosts.nextAttemptAt))
      .limit(limit)
      .for('update', { skipLocked: true });

    return this.db
      .update(rawPosts)
      .set({
        processingStatus: 'processing',
        processingAttempts: sql`${rawPosts.processingAttempts} + 1`,
        processingStartedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(inArray(rawPosts.id, due))
      .returning();
  }

  /** Return jobs abandoned by a crashed or restarted worker to the queue. */
  async recoverStale(staleAfterMs: number, maxAttempts: number): Promise<number> {
    const recovered = await this.db
      .update(rawPosts)
      .set({
        processingStatus: sql`case when ${rawPosts.processingAttempts} >= ${maxAttempts}
          then 'failed'::processing_status else 'pending'::processing_status end`,
        nextAttemptAt: sql`now()`,
        processingStartedAt: null,
        lastError: 'Processing was interrupted before completion',
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(rawPosts.processingStatus, 'processing'),
          sql`${rawPosts.processingStartedAt} < now() - make_interval(secs => ${staleAfterMs / 1000})`,
        ),
      )
      .returning({ id: rawPosts.id });
    return recovered.length;
  }

  /** Persist parsed sessions and mark the job parsed in one transaction. */
  /**
   * Persist parsed sessions in one transaction, skipping any session that duplicates a
   * stored one (same author, levels, location and time). A post whose sessions were all
   * duplicates becomes `duplicate` and points at the earlier post. Returns null when the
   * claim was lost to another worker.
   */
  async completeParsed(
    claim: JobClaim,
    sessions: Array<{ row: NewBadmintonSession; levels: LevelCode[] }>,
  ): Promise<CompleteParsedResult | null> {
    return this.db.transaction(async (tx) => {
      const updated = await tx
        .update(rawPosts)
        .set({
          processingStatus: 'parsed',
          processedAt: sql`now()`,
          processingStartedAt: null,
          lastError: null,
          updatedAt: sql`now()`,
        })
        .where(this.ownsClaim(claim))
        .returning({ id: rawPosts.id });
      if (updated.length === 0) return null;

      let inserted = 0;
      let duplicateOf: string | null = null;
      for (const { row, levels } of sessions) {
        // Serialize concurrent workers saving the same session.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${duplicateKey(row, levels)}))`);
        const existing = await findDuplicateSession(tx as unknown as Database, row, levels);
        if (existing) {
          duplicateOf ??= existing.rawPostId;
          continue;
        }
        const [session] = await tx.insert(badmintonSessions).values(row).returning({ id: badmintonSessions.id });
        if (session && levels.length > 0) {
          await tx.insert(sessionLevels).values(levels.map((levelCode) => ({ sessionId: session.id, levelCode })));
        }
        inserted += 1;
      }

      if (inserted === 0 && duplicateOf) {
        await tx
          .update(rawPosts)
          .set({ processingStatus: 'duplicate', duplicateOfPostId: duplicateOf })
          .where(eq(rawPosts.id, claim.id));
        return { status: 'duplicate', inserted, skipped: sessions.length };
      }
      return { status: 'parsed', inserted, skipped: sessions.length - inserted };
    });
  }

  /** `skipReason` records a pre-AI rule; omit it when the AI made the call. */
  async completeIrrelevant(claim: JobClaim, skipReason: string | null = null): Promise<boolean> {
    return this.finish(claim, {
      processingStatus: 'irrelevant',
      processedAt: sql`now()`,
      lastError: null,
      skipReason,
    });
  }

  async scheduleRetry(claim: JobClaim, nextAttemptAt: Date, error: string): Promise<boolean> {
    return this.finish(claim, { processingStatus: 'pending', nextAttemptAt, lastError: error });
  }

  async fail(claim: JobClaim, error: string): Promise<boolean> {
    return this.finish(claim, {
      processingStatus: 'failed',
      processedAt: sql`now()`,
      lastError: error,
    });
  }

  /** Manual recovery after fixing e.g. an invalid API key. */
  async requeueFailed(): Promise<number> {
    const rows = await this.db
      .update(rawPosts)
      .set({
        processingStatus: 'pending',
        processingAttempts: 0,
        nextAttemptAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(rawPosts.processingStatus, 'failed'))
      .returning({ id: rawPosts.id });
    return rows.length;
  }

  /** Newest first, with the number of sessions parsed from each post. */
  async list(query: { page: number; pageSize: number; status?: ProcessingStatus }) {
    const where = query.status ? eq(rawPosts.processingStatus, query.status) : undefined;
    const [rows, totals] = await Promise.all([
      this.db
        .select({
          post: rawPosts,
          // Qualified explicitly: Drizzle renders a bare "id", which the subquery would resolve to s.id.
          sessionCount: sql<number>`(select count(*)::int from badminton_sessions s where s.raw_post_id = "raw_posts"."id")`,
        })
        .from(rawPosts)
        .where(where)
        .orderBy(desc(rawPosts.createdAt), desc(rawPosts.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ total: sql<number>`count(*)::int` }).from(rawPosts).where(where),
    ]);
    return { rows, total: totals[0]?.total ?? 0 };
  }

  async countByStatus(): Promise<Record<ProcessingStatus, number>> {
    const counts = Object.fromEntries(processingStatusEnum.enumValues.map((status) => [status, 0])) as Record<
      ProcessingStatus,
      number
    >;
    const rows = await this.db
      .select({ status: rawPosts.processingStatus, count: sql<number>`count(*)::int` })
      .from(rawPosts)
      .groupBy(rawPosts.processingStatus);
    for (const row of rows) counts[row.status] = row.count;
    return counts;
  }

  async findById(id: string): Promise<RawPost | undefined> {
    const [row] = await this.db.select().from(rawPosts).where(eq(rawPosts.id, id)).limit(1);
    return row;
  }

  private async finish(
    claim: JobClaim,
    values: PgUpdateSetSource<typeof rawPosts>,
  ): Promise<boolean> {
    const updated = await this.db
      .update(rawPosts)
      .set({ ...values, processingStartedAt: null, updatedAt: sql`now()` })
      .where(this.ownsClaim(claim))
      .returning({ id: rawPosts.id });
    return updated.length > 0;
  }

  private ownsClaim(claim: JobClaim) {
    return and(
      eq(rawPosts.id, claim.id),
      eq(rawPosts.processingStatus, 'processing'),
      eq(rawPosts.processingAttempts, claim.attempt),
    );
  }
}
