import { and, asc, sql } from 'drizzle-orm';
import type { Database } from '../../database/client.js';
import { badmintonSessions, type LevelCode, type NewBadmintonSession } from '../../database/schema.js';
import { sortLevels } from '../../lib/levels.js';

/*
 * Two sessions are duplicates when ALL of these match:
 *   author · normalized level set · location (accent/case-insensitive) · play date + start + end time
 * Missing values only match missing values (IS NOT DISTINCT FROM).
 */

export const levelsKey = (levels: LevelCode[]) => sortLevels(levels).join(',');

/**
 * Stable text key, used for the advisory lock that serializes concurrent checks.
 * Joined with U+001F: Postgres text cannot hold NUL.
 */
export function duplicateKey(row: NewBadmintonSession, levels: LevelCode[]): string {
  return [row.author, row.playDate, row.startTime, row.endTime, row.locationSearch, levelsKey(levels)]
    .map((part) => part ?? '')
    .join('\u001f');
}

/** Comma-joined level codes of a session, in enum order (matches levelsKey()). */
export const sessionLevelsKeySql = sql<string>`coalesce((
  select string_agg(sl.level_code::text, ',' order by sl.level_code)
  from session_levels sl where sl.session_id = "badminton_sessions"."id"
), '')`;

/** The earliest stored session that this one would duplicate, if any. */
export async function findDuplicateSession(
  db: Database,
  row: NewBadmintonSession,
  levels: LevelCode[],
): Promise<{ id: string; rawPostId: string } | undefined> {
  const [match] = await db
    .select({ id: badmintonSessions.id, rawPostId: badmintonSessions.rawPostId })
    .from(badmintonSessions)
    .where(
      and(
        sql`${badmintonSessions.author} is not distinct from ${row.author ?? null}::text`,
        sql`${badmintonSessions.playDate} is not distinct from ${row.playDate ?? null}::date`,
        sql`${badmintonSessions.startTime} is not distinct from ${row.startTime ?? null}::time`,
        sql`${badmintonSessions.endTime} is not distinct from ${row.endTime ?? null}::time`,
        sql`${badmintonSessions.locationSearch} is not distinct from ${row.locationSearch ?? null}::text`,
        sql`${sessionLevelsKeySql} = ${levelsKey(levels)}`,
      ),
    )
    .orderBy(asc(badmintonSessions.createdAt), asc(badmintonSessions.id))
    .limit(1);
  return match;
}
