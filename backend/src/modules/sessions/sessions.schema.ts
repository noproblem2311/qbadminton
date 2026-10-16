import { z } from 'zod';
import { skillLevelCodeEnum } from '../../database/schema.js';
import { isValidIsoDate, isValidTime } from '../../lib/time.js';

/** Optional HH:mm bound on the session start time. */
const optionalTime = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined))
  .refine((value) => value === undefined || isValidTime(value), 'time must be HH:mm (00:00–23:59)');

const optionalFilter = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

export const listSessionsQuerySchema = z.object({
  date: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined))
    .refine((value) => value === undefined || isValidIsoDate(value), 'date must be YYYY-MM-DD'),
  /** Comma-separated level codes, e.g. `level=TB,TB_PLUS` (matches any of them). */
  level: z
    .string()
    .optional()
    .transform((value) => (value ? [...new Set(value.split(',').map((code) => code.trim()).filter(Boolean))] : []))
    .pipe(z.array(z.enum(skillLevelCodeEnum.enumValues)).max(skillLevelCodeEnum.enumValues.length)),
  location: optionalFilter(100),
  /** Start-time window, inclusive; timeFrom > timeTo means a window across midnight. */
  timeFrom: optionalTime,
  timeTo: optionalTime,
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export type ListSessionsQuery = z.infer<typeof listSessionsQuerySchema>;

export const sessionIdParamsSchema = z.object({ id: z.uuid() });
