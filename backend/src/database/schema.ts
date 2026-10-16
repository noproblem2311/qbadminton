import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const processingStatusEnum = pgEnum('processing_status', [
  'pending',
  'processing',
  'parsed',
  'failed',
  'irrelevant',
  /** All of the post's sessions already existed (same author, levels, location and time). */
  'duplicate',
]);

export type ProcessingStatus = (typeof processingStatusEnum.enumValues)[number];

/** The only six skill levels; the enum makes any other value impossible. */
export const skillLevelCodeEnum = pgEnum('skill_level_code', ['YEU', 'TBY', 'TB_MINUS', 'TB', 'TB_PLUS', 'KHA']);

export type LevelCode = (typeof skillLevelCodeEnum.enumValues)[number];

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/**
 * Raw posts exactly as captured by the extension. The processing columns make this
 * table double as the job queue (claimed with FOR UPDATE SKIP LOCKED), so no
 * separate processing_jobs table is needed.
 */
export const rawPosts = pgTable(
  'raw_posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facebookPostId: text('facebook_post_id'),
    groupId: text('group_id'),
    postUrl: text('post_url'),
    author: text('author'),
    content: text('content').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    /** sha256 of group + author + normalized content; computed server-side. */
    fingerprint: text('fingerprint').notNull(),

    processingStatus: processingStatusEnum('processing_status').notNull().default('pending'),
    processingAttempts: integer('processing_attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    lastError: text('last_error'),
    /** Set when a rule marked the post irrelevant without calling the AI. */
    skipReason: text('skip_reason'),
    /** For duplicate posts: the earlier post whose session this one repeats. */
    duplicateOfPostId: uuid('duplicate_of_post_id').references((): AnyPgColumn => rawPosts.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (t) => [
    // Primary dedup key: one row per Facebook post within a group.
    uniqueIndex('raw_posts_group_post_uidx')
      .on(sql`coalesce(group_id, '')`, t.facebookPostId)
      .where(sql`facebook_post_id is not null`),
    // Fallback dedup key for posts captured without a Facebook post ID.
    uniqueIndex('raw_posts_fingerprint_without_post_id_uidx')
      .on(t.fingerprint)
      .where(sql`facebook_post_id is null`),
    index('raw_posts_fingerprint_idx').on(t.fingerprint),
    index('raw_posts_pending_queue_idx')
      .on(t.nextAttemptAt)
      .where(sql`processing_status = 'pending'`),
    index('raw_posts_processing_started_idx')
      .on(t.processingStartedAt)
      .where(sql`processing_status = 'processing'`),
  ],
);

export const badmintonSessions = pgTable(
  'badminton_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rawPostId: uuid('raw_post_id')
      .notNull()
      .references(() => rawPosts.id),
    author: text('author'),
    playDate: date('play_date', { mode: 'string' }),
    startTime: time('start_time'),
    endTime: time('end_time'),
    level: text('level'),
    location: text('location'),
    content: text('content').notNull(),
    /** play_date + start_time in Asia/Ho_Chi_Minh; null when either part is unknown. */
    startsAt: timestamp('starts_at', { withTimezone: true }),
    /** Lowercased, diacritic-free copy used for accent-insensitive filtering. */
    locationSearch: text('location_search'),
    ...timestamps,
  },
  (t) => [
    index('badminton_sessions_starts_at_idx').on(t.startsAt),
    index('badminton_sessions_play_date_idx').on(t.playDate),
    index('badminton_sessions_raw_post_idx').on(t.rawPostId),
  ],
);

/** Lookup table holding exactly the six skill levels (seeded by migration). */
export const skillLevels = pgTable('skill_levels', {
  code: skillLevelCodeEnum('code').primaryKey(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().unique(),
});

/** Levels a session asks for: one session → many of the six levels. */
export const sessionLevels = pgTable(
  'session_levels',
  {
    sessionId: uuid('session_id')
      .notNull()
      .references(() => badmintonSessions.id, { onDelete: 'cascade' }),
    levelCode: skillLevelCodeEnum('level_code')
      .notNull()
      .references(() => skillLevels.code),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.levelCode] }),
    index('session_levels_level_code_idx').on(t.levelCode),
  ],
);

/** Last run of each periodic maintenance job, so schedules survive restarts. */
export const maintenanceRuns = pgTable('maintenance_runs', {
  job: text('job').primaryKey(),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }).notNull(),
  details: text('details'),
});

export type RawPost = typeof rawPosts.$inferSelect;
export type NewRawPost = typeof rawPosts.$inferInsert;
export type BadmintonSession = typeof badmintonSessions.$inferSelect;
export type NewBadmintonSession = typeof badmintonSessions.$inferInsert;
