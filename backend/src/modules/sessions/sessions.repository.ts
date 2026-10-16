import { and, asc, eq, exists, gte, ilike, inArray, isNotNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../database/client.js';
import {
  badmintonSessions,
  rawPosts,
  sessionLevels,
  type BadmintonSession,
  type LevelCode,
} from '../../database/schema.js';
import { escapeLikePattern, normalizeSearchText } from '../../lib/text.js';

export interface SessionFilters {
  date?: string;
  /** Sessions asking for any of these levels. */
  levels?: LevelCode[];
  location?: string;
  /** HH:mm, inclusive lower bound on the start time. */
  timeFrom?: string;
  /** HH:mm, inclusive upper bound on the start time. */
  timeTo?: string;
  limit: number;
  offset: number;
}

export interface SessionWithSource {
  session: BadmintonSession;
  postUrl: string | null;
  facebookPostId: string | null;
  groupId: string | null;
  levels: LevelCode[];
}

export class SessionsRepository {
  constructor(private readonly db: Database) {}

  /**
   * Upcoming sessions only: starts_at (play date + start time in Asia/Ho_Chi_Minh)
   * must be at or after `now`. Defaults to the database clock, which is authoritative.
   * Sessions without a valid start date/time have a null starts_at and never match.
   */
  async listUpcoming(query: SessionFilters, now?: Date): Promise<SessionWithSource[]> {
    const conditions: SQL[] = [
      isNotNull(badmintonSessions.startsAt),
      gte(badmintonSessions.startsAt, now ?? sql`now()`),
    ];
    if (query.date) conditions.push(eq(badmintonSessions.playDate, query.date));
    if (query.levels?.length) {
      conditions.push(
        exists(
          this.db
            .select({ one: sql`1` })
            .from(sessionLevels)
            .where(
              and(
                eq(sessionLevels.sessionId, badmintonSessions.id),
                inArray(sessionLevels.levelCode, query.levels),
              ),
            ),
        ),
      );
    }
    if (query.location) {
      conditions.push(ilike(badmintonSessions.locationSearch, containsPattern(query.location)));
    }
    const timeWindow = startTimeWindow(query.timeFrom, query.timeTo);
    if (timeWindow) conditions.push(timeWindow);

    const rows = await this.db
      .select(sourceColumns)
      .from(badmintonSessions)
      .innerJoin(rawPosts, eq(badmintonSessions.rawPostId, rawPosts.id))
      .where(and(...conditions))
      .orderBy(asc(badmintonSessions.startsAt), asc(badmintonSessions.createdAt))
      .limit(query.limit)
      .offset(query.offset);
    return this.withLevels(rows);
  }

  async findById(id: string): Promise<SessionWithSource | undefined> {
    const rows = await this.db
      .select(sourceColumns)
      .from(badmintonSessions)
      .innerJoin(rawPosts, eq(badmintonSessions.rawPostId, rawPosts.id))
      .where(eq(badmintonSessions.id, id))
      .limit(1);
    return (await this.withLevels(rows))[0];
  }

  private async withLevels(rows: Array<Omit<SessionWithSource, 'levels'>>): Promise<SessionWithSource[]> {
    if (rows.length === 0) return [];
    const links = await this.db
      .select()
      .from(sessionLevels)
      .where(inArray(sessionLevels.sessionId, rows.map((row) => row.session.id)));
    const bySession = new Map<string, LevelCode[]>();
    for (const link of links) {
      bySession.set(link.sessionId, [...(bySession.get(link.sessionId) ?? []), link.levelCode]);
    }
    return rows.map((row) => ({ ...row, levels: bySession.get(row.session.id) ?? [] }));
  }
}

const sourceColumns = {
  session: badmintonSessions,
  postUrl: rawPosts.postUrl,
  facebookPostId: rawPosts.facebookPostId,
  groupId: rawPosts.groupId,
};

/** Start time within [from, to], inclusive; from > to wraps past midnight (e.g. 21:00–01:00). */
function startTimeWindow(from?: string, to?: string): SQL | undefined {
  const start = badmintonSessions.startTime;
  if (from && to) {
    return from <= to ? and(gte(start, from), lte(start, to)) : or(gte(start, from), lte(start, to));
  }
  if (from) return gte(start, from);
  if (to) return lte(start, to);
  return undefined;
}

function containsPattern(value: string): string {
  return `%${escapeLikePattern(normalizeSearchText(value))}%`;
}
