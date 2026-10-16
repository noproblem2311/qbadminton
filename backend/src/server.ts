import { ClaudeClient } from './ai/claude.client.js';
import { ClaudePostSerializer } from './ai/post.serializer.js';
import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createDatabase } from './database/client.js';
import { runMigrations } from './database/migrate.js';
import { CleanupScheduler } from './jobs/cleanup.js';
import { PostProcessor } from './jobs/post-processor.js';
import { ProcessingWorker } from './jobs/processing.worker.js';
import { PostsRepository } from './modules/posts/posts.repository.js';

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
let worker: ProcessingWorker | null = null;

const app = buildApp({
  db: database.db,
  ingestApiKey: config.INGEST_API_KEY,
  onPostsAccepted: () => worker?.notify(),
  logger: {
    level: config.LOG_LEVEL,
    redact: ['req.headers.authorization', 'req.headers["x-api-key"]'],
  },
});

if (config.RUN_MIGRATIONS) {
  await runMigrations(config.DATABASE_URL);
  app.log.info('database migrations applied');
}

if (!config.WORKER_ENABLED) {
  app.log.info('processing worker disabled (WORKER_ENABLED=false)');
} else if (!config.ANTHROPIC_API_KEY) {
  app.log.warn('ANTHROPIC_API_KEY is not set: worker idle, ingested posts stay pending');
} else {
  const workerLog = app.log.child({ component: 'worker' });
  const posts = new PostsRepository(database.db);
  const serializer = new ClaudePostSerializer(
    ClaudeClient.fromApiKey(config.ANTHROPIC_API_KEY, config.CLAUDE_MODEL),
    workerLog,
  );
  const processor = new PostProcessor(posts, serializer, workerLog, {
    maxAttempts: config.JOB_MAX_ATTEMPTS,
    backoffBaseMs: config.JOB_BACKOFF_BASE_MS,
    backoffMaxMs: config.JOB_BACKOFF_MAX_MS,
  });
  worker = new ProcessingWorker(posts, processor, workerLog, {
    concurrency: config.WORKER_CONCURRENCY,
    pollIntervalMs: config.WORKER_POLL_INTERVAL_MS,
    staleAfterMs: config.JOB_STALE_AFTER_MS,
    maxAttempts: config.JOB_MAX_ATTEMPTS,
  });
}

const cleanup = config.CLEANUP_ENABLED
  ? new CleanupScheduler(database.db, app.log.child({ component: 'cleanup' }), {
      retentionDays: config.CLEANUP_RETENTION_DAYS,
      intervalHours: config.CLEANUP_INTERVAL_HOURS,
    })
  : null;

await app.listen({ host: config.HOST, port: config.PORT });
worker?.start();
cleanup?.start();

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  cleanup?.stop();
  await worker?.stop();
  await app.close();
  await database.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
