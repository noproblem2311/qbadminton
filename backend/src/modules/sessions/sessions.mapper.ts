import type { LevelCode, NewBadmintonSession, RawPost } from '../../database/schema.js';
import { levelName, normalizeLevels, sortLevels } from '../../lib/levels.js';
import { normalizeSearchText } from '../../lib/text.js';
import { toStartsAt } from '../../lib/time.js';
import type { BadmintonPost } from '../../ai/post.schema.js';
import type { SessionWithSource } from './sessions.repository.js';

export interface SessionDto {
  id: string;
  author: string | null;
  playDate: string | null;
  startTime: string | null;
  endTime: string | null;
  /** Level phrase as written in the post. */
  level: string | null;
  /** Normalized levels (subset of the six), weakest first. */
  levels: Array<{ code: LevelCode; name: string }>;
  location: string | null;
  content: string;
  postUrl: string | null;
  startsAt: string | null;
  createdAt: string;
}

/** Postgres `time` comes back as HH:mm:ss; the API speaks HH:mm. */
const toHourMinute = (value: string | null) => (value ? value.slice(0, 5) : null);

export function buildPostUrl(row: Pick<SessionWithSource, 'postUrl' | 'facebookPostId' | 'groupId'>): string | null {
  if (row.postUrl) return row.postUrl;
  if (!row.facebookPostId) return null;
  return row.groupId
    ? `https://www.facebook.com/groups/${row.groupId}/posts/${row.facebookPostId}/`
    : `https://www.facebook.com/${row.facebookPostId}`;
}

export function toSessionDto(row: SessionWithSource): SessionDto {
  const { session } = row;
  return {
    id: session.id,
    author: session.author,
    playDate: session.playDate,
    startTime: toHourMinute(session.startTime),
    endTime: toHourMinute(session.endTime),
    level: session.level,
    levels: sortLevels(row.levels).map((code) => ({ code, name: levelName(code) })),
    location: session.location,
    content: session.content,
    postUrl: buildPostUrl(row),
    startsAt: session.startsAt?.toISOString() ?? null,
    createdAt: session.createdAt.toISOString(),
  };
}

export interface SessionInsert {
  row: NewBadmintonSession;
  levels: LevelCode[];
}

export function toSessionInsert(rawPost: RawPost, post: BadmintonPost): SessionInsert {
  return {
    row: {
      rawPostId: rawPost.id,
      author: post.author,
      playDate: post.playDate,
      startTime: post.startTime,
      endTime: post.endTime,
      level: post.level,
      location: post.location,
      content: post.content,
      startsAt: toStartsAt(post.playDate, post.startTime),
      locationSearch: post.location ? normalizeSearchText(post.location) : null,
    },
    levels: normalizeLevels(post.level),
  };
}
