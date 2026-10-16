import { createDatabase } from '../database/client.js';
import { maintenanceRuns } from '../database/schema.js';
import { CLEANUP_JOB, cleanupOldData } from './cleanup.js';

/** CLI: delete data older than CLEANUP_RETENTION_DAYS (default 2) right now. */
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const retentionDays = Number(process.env.CLEANUP_RETENTION_DAYS ?? 2);

const handle = createDatabase(url);
try {
  const now = new Date();
  const result = await cleanupOldData(handle.db, { retentionDays, now });
  const details = JSON.stringify(result);
  await handle.db
    .insert(maintenanceRuns)
    .values({ job: CLEANUP_JOB, lastRunAt: now, details })
    .onConflictDoUpdate({ target: maintenanceRuns.job, set: { lastRunAt: now, details } });
  console.log(
    `Deleted ${result.sessionsDeleted} session(s) and ${result.postsDeleted} raw post(s) older than ${result.cutoff}.`,
  );
} finally {
  await handle.close();
}
