import { z } from 'zod';
import { addDays, isValidIsoDate, isValidTime, normalizeTime } from '../lib/time.js';

/**
 * JSON shape Claude must return, sent as the structured-output schema. It is kept
 * loose on purpose; strict normalization and validation happen afterwards.
 */
export const aiSessionSchema = z.object({
  playDate: z.string().nullable(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  level: z.string().nullable(),
  location: z.string().nullable(),
});

export const aiOutputSchema = z.object({
  relevant: z.boolean(),
  sessions: z.array(aiSessionSchema),
});

export type AiSession = z.infer<typeof aiSessionSchema>;
export type AiOutput = z.infer<typeof aiOutputSchema>;

/** The validated entity that becomes one badminton_sessions row. */
export const badmintonPostSchema = z.object({
  author: z.string().trim().min(1).max(200).nullable(),
  playDate: z.string().refine(isValidIsoDate, 'playDate must be YYYY-MM-DD').nullable(),
  startTime: z.string().refine(isValidTime, 'startTime must be HH:mm').nullable(),
  endTime: z.string().refine(isValidTime, 'endTime must be HH:mm').nullable(),
  level: z.string().trim().min(1).max(100).nullable(),
  location: z.string().trim().min(1).max(300).nullable(),
  content: z.string().min(1),
});

export type BadmintonPost = z.infer<typeof badmintonPostSchema>;

export type SessionDetails = Pick<
  BadmintonPost,
  'playDate' | 'startTime' | 'endTime' | 'level' | 'location'
>;

export const EMPTY_SESSION_DETAILS: SessionDetails = {
  playDate: null,
  startTime: null,
  endTime: null,
  level: null,
  location: null,
};

function cleanText(value: string | null, max: number): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s+/gu, ' ').trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

/**
 * Coerce one AI-produced session into clean values. Anything unusable becomes null
 * instead of being guessed. Dates far from the reference date are treated as misreads.
 */
export function sanitizeAiSession(raw: AiSession, referenceDate: string): SessionDetails {
  const candidate = raw.playDate?.trim() ?? null;
  const playDate =
    candidate &&
    isValidIsoDate(candidate) &&
    candidate >= addDays(referenceDate, -1) &&
    candidate <= addDays(referenceDate, 90)
      ? candidate
      : null;

  return {
    playDate,
    startTime: normalizeTime(raw.startTime),
    endTime: normalizeTime(raw.endTime),
    level: cleanText(raw.level, 100),
    location: cleanText(raw.location, 300),
  };
}
