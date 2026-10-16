import { z } from 'zod';

const booleanFromString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  DATABASE_URL: z.string().min(1),
  RUN_MIGRATIONS: booleanFromString.default(true),

  /** Shared secret the Chrome extension sends as `Authorization: Bearer <key>`. */
  INGEST_API_KEY: z.string().min(24, 'INGEST_API_KEY must be at least 24 characters'),

  /** Optional: without it the processing worker stays idle and posts remain pending. */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  CLAUDE_MODEL: z.string().min(1).default('claude-haiku-5-5'),

  WORKER_ENABLED: booleanFromString.default(true),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(500).default(5_000),
  JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  JOB_BACKOFF_BASE_MS: z.coerce.number().int().min(100).default(30_000),
  JOB_BACKOFF_MAX_MS: z.coerce.number().int().min(1_000).default(30 * 60_000),
  JOB_STALE_AFTER_MS: z.coerce.number().int().min(10_000).default(10 * 60_000),

  /** Periodic deletion of old sessions and raw posts. */
  CLEANUP_ENABLED: booleanFromString.default(true),
  CLEANUP_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(2),
  CLEANUP_INTERVAL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(48),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // Docker Compose passes unset variables as empty strings; treat them as missing.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
