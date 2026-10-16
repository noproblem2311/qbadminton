import { fileURLToPath } from 'node:url';
import { and, eq, sql } from 'drizzle-orm';
import { createDatabase, type Database } from '../database/client.js';
import { rawPosts } from '../database/schema.js';
import { sessionLevelsKeySql } from '../modules/sessions/session-dedup.js';

export interface DedupeResult {
  sessionsDeleted: number;
  postsMarkedDuplicate: number;
}

/**
 * Remove already-stored duplicate sessions (same author, levels, location and time),
 * keeping the earliest one. Posts left without sessions become `duplicate`.
 */
export async function dedupeExistingSessions(db: Database): Promise<DedupeResult> {
  return db.transaction(async (tx) => {
    const deleted = (await tx.execute(sql`
      with keyed as (
        select id, raw_post_id, created_at, author, play_date, start_time, end_time, location_search,
               ${sessionLevelsKeySql} as levels_key
        from badminton_sessions
      ), ranked as (
        select id,
               row_number() over w as rn,
               first_value(raw_post_id) over w as keep_post_id
        from keyed
        window w as (
          partition by author, play_date, start_time, end_time, location_search, levels_key
          order by created_at, id
        )
      )
      delete from badminton_sessions b
      using ranked r
      where b.id = r.id and r.rn > 1
      returning b.raw_post_id as "rawPostId", r.keep_post_id as "keepPostId"
    `)) as unknown as { rows: Array<{ rawPostId: string; keepPostId: string }> };

    let postsMarkedDuplicate = 0;
    const seen = new Set<string>();
    for (const { rawPostId, keepPostId } of deleted.rows) {
      if (seen.has(rawPostId) || rawPostId === keepPostId) continue;
      seen.add(rawPostId);
      const marked = await tx
        .update(rawPosts)
        .set({ processingStatus: 'duplicate', duplicateOfPostId: keepPostId, updatedAt: sql`now()` })
        .where(
          and(
            eq(rawPosts.id, rawPostId),
            eq(rawPosts.processingStatus, 'parsed'),
            sql`not exists (select 1 from badminton_sessions s where s.raw_post_id = "raw_posts"."id")`,
          ),
        )
        .returning({ id: rawPosts.id });
      postsMarkedDuplicate += marked.length;
    }
    return { sessionsDeleted: deleted.rows.length, postsMarkedDuplicate };
  });
}

// CLI: node dist/jobs/dedupe-sessions.js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDatabase(url);
  try {
    const result = await dedupeExistingSessions(handle.db);
    console.log(
      `Removed ${result.sessionsDeleted} duplicate session(s); marked ${result.postsMarkedDuplicate} post(s) as duplicate.`,
    );
  } finally {
    await handle.close();
  }
}
