import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Database } from '../../src/database/client.js';
import { MIGRATIONS_FOLDER } from '../../src/database/migrate.js';
import * as schema from '../../src/database/schema.js';

/** Real PostgreSQL (PGlite, in-process) with the production migrations applied. */
export async function createTestDatabase() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return {
    db: db as unknown as Database,
    reset: async () => {
      await db.execute(sql`truncate table session_levels, badminton_sessions, raw_posts, maintenance_runs`);
    },
    close: () => client.close(),
  };
}

export const TEST_API_KEY = 'test-ingest-key-0123456789abcdef';
