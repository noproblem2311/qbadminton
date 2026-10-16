import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';
import * as schema from './schema.js';

/** Driver-agnostic Drizzle handle (node-postgres in production, PGlite in tests). */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DatabaseHandle {
  db: Database;
  close: () => Promise<void>;
}

export function createDatabase(connectionString: string): DatabaseHandle {
  const pool = new pg.Pool({ connectionString, max: 10 });
  const db = drizzle(pool, { schema }) as unknown as Database;
  return { db, close: () => pool.end() };
}
